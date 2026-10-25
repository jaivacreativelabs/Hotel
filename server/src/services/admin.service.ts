/** Super Admin operations: restaurants, branches and Restaurant Admin accounts. */
import type { Types } from 'mongoose';
import {
  STAFF_ROLES,
  type BranchCreateInput,
  type RecordStatus,
  type RestaurantCreateInput,
  type RestaurantSettingsInput,
  type UserCreateInput,
} from '@rb/shared';
import { runInTransaction } from '../config/transaction.js';
import type { AuthUser } from '../middleware/auth.js';
import type { BranchLean, RestaurantLean } from '../middleware/scope.js';
import { BranchModel, RestaurantModel, UserModel } from '../models/index.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { toBranchDTO, toRestaurantDTO, toUserDTO } from '../utils/serialize.js';
import { nameKey, toObjectId } from '../utils/validate.js';
import { audit } from './audit.service.js';
import { hashPassword } from './auth.service.js';

// ---------------- Restaurants ----------------

export async function listRestaurants(status?: string) {
  const filter = status === 'ACTIVE' || status === 'INACTIVE' ? { status } : {};
  const restaurants = await RestaurantModel.find(filter).sort({ name: 1 }).lean<RestaurantLean[]>();
  const counts = await BranchModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $group: { _id: '$restaurantId', n: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.n]));
  return restaurants.map((r) => toRestaurantDTO(r, byId.get(String(r._id)) ?? 0));
}

async function getRestaurantOr404(id: string) {
  const r = await RestaurantModel.findById(toObjectId(id, 'restaurant'));
  if (!r) throw notFound('Restaurant');
  return r;
}

async function assertRestaurantNameFree(name: string, exceptId?: Types.ObjectId) {
  const clash = await RestaurantModel.exists({ nameKey: nameKey(name), ...(exceptId && { _id: { $ne: exceptId } }) });
  if (clash) throw conflict('A restaurant with this name already exists', 'DUPLICATE');
}

export const MAIN_BRANCH = { name: 'Main Branch', code: 'MAIN' } as const;

/**
 * Creates a restaurant together with its "Main Branch" (code MAIN, contact details copied from
 * the restaurant), in one transaction, so a new restaurant is ready for tables, menu and
 * admins straight away. The branch can be renamed later.
 */
export async function createRestaurant(actor: AuthUser, input: RestaurantCreateInput) {
  await assertRestaurantNameFree(input.name);
  const { restaurant, branch } = await runInTransaction(async (session) => {
    const [r] = await RestaurantModel.create([{ ...input, nameKey: nameKey(input.name) }], { session });
    const [b] = await BranchModel.create(
      [
        {
          restaurantId: r._id,
          name: MAIN_BRANCH.name,
          nameKey: nameKey(MAIN_BRANCH.name),
          code: MAIN_BRANCH.code,
          address: input.address ?? '',
          phone: input.phone ?? '',
          email: input.email ?? '',
        },
      ],
      { session },
    );
    await audit(
      actor,
      {
        action: 'RESTAURANT_CREATED',
        entityType: 'Restaurant',
        entityId: r._id,
        restaurantId: r._id,
        branchId: b._id,
        summary: `Created restaurant "${r.name}" with its ${MAIN_BRANCH.name} (${MAIN_BRANCH.code})`,
      },
      session,
    );
    return { restaurant: r, branch: b };
  });
  return { ...toRestaurantDTO(restaurant.toObject() as RestaurantLean, 1), mainBranchId: String(branch._id) };
}

export async function getRestaurantDetail(id: string) {
  const r = await getRestaurantOr404(id);
  const branches = await BranchModel.find({ restaurantId: r._id }).sort({ name: 1 }).lean<BranchLean[]>();
  const admins = await UserModel.find({ role: { $in: STAFF_ROLES }, restaurantIds: r._id })
    .sort({ name: 1 })
    .lean<AuthUser[]>();
  return {
    restaurant: toRestaurantDTO(r.toObject() as RestaurantLean, branches.length),
    branches: branches.map(toBranchDTO),
    admins: admins.map(toUserDTO),
  };
}

export async function updateRestaurant(actor: AuthUser, id: string, input: Partial<RestaurantCreateInput>) {
  const r = await getRestaurantOr404(id);
  if (input.name && nameKey(input.name) !== r.nameKey) {
    await assertRestaurantNameFree(input.name, r._id);
    r.nameKey = nameKey(input.name);
  }
  r.set(input);
  await r.save();
  await audit(actor, {
    action: 'RESTAURANT_UPDATED',
    entityType: 'Restaurant',
    entityId: r._id,
    restaurantId: r._id,
    summary: `Updated restaurant "${r.name}"`,
    meta: { fields: Object.keys(input) },
  });
  return toRestaurantDTO(r.toObject() as RestaurantLean);
}

export async function setRestaurantStatus(actor: AuthUser, id: string, status: RecordStatus) {
  const r = await getRestaurantOr404(id);
  r.status = status;
  await r.save();
  await audit(actor, {
    action: status === 'ACTIVE' ? 'RESTAURANT_ACTIVATED' : 'RESTAURANT_DEACTIVATED',
    entityType: 'Restaurant',
    entityId: r._id,
    restaurantId: r._id,
    summary: `${status === 'ACTIVE' ? 'Activated' : 'Deactivated'} restaurant "${r.name}"`,
  });
  return toRestaurantDTO(r.toObject() as RestaurantLean);
}

export async function updateRestaurantSettings(actor: AuthUser, id: string, input: RestaurantSettingsInput) {
  const r = await getRestaurantOr404(id);
  const before = r.toObject().settings;
  r.settings = input as typeof r.settings;
  await r.save();
  await audit(actor, {
    action: 'RESTAURANT_SETTINGS_UPDATED',
    entityType: 'Restaurant',
    entityId: r._id,
    restaurantId: r._id,
    summary: `Updated tax/receipt settings of "${r.name}"`,
    meta: { before, after: input },
  });
  return toRestaurantDTO(r.toObject() as RestaurantLean);
}

// ---------------- Branches ----------------

export async function listBranches(restaurantId?: unknown) {
  const filter = restaurantId ? { restaurantId: toObjectId(restaurantId, 'restaurant') } : {};
  const branches = await BranchModel.find(filter).sort({ name: 1 }).lean<BranchLean[]>();
  return branches.map(toBranchDTO);
}

async function assertBranchUnique(restaurantId: Types.ObjectId, name?: string, code?: string, exceptId?: Types.ObjectId) {
  const except = exceptId ? { _id: { $ne: exceptId } } : {};
  if (code && (await BranchModel.exists({ restaurantId, code, ...except }))) {
    throw conflict(`Branch code "${code}" is already used in this restaurant`, 'DUPLICATE');
  }
  if (name && (await BranchModel.exists({ restaurantId, nameKey: nameKey(name), ...except }))) {
    throw conflict(`A branch named "${name}" already exists in this restaurant`, 'DUPLICATE');
  }
}

export async function createBranch(actor: AuthUser, input: BranchCreateInput) {
  const restaurant = await getRestaurantOr404(input.restaurantId);
  await assertBranchUnique(restaurant._id, input.name, input.code);
  const b = await BranchModel.create({ ...input, restaurantId: restaurant._id, nameKey: nameKey(input.name) });
  await audit(actor, {
    action: 'BRANCH_CREATED',
    entityType: 'Branch',
    entityId: b._id,
    restaurantId: restaurant._id,
    branchId: b._id,
    summary: `Created branch "${b.name}" (${b.code}) in "${restaurant.name}"`,
  });
  return toBranchDTO(b.toObject() as BranchLean);
}

async function getBranchOr404(id: string) {
  const b = await BranchModel.findById(toObjectId(id, 'branch'));
  if (!b) throw notFound('Branch');
  return b;
}

export async function updateBranch(actor: AuthUser, id: string, input: Partial<Omit<BranchCreateInput, 'restaurantId'>>) {
  const b = await getBranchOr404(id);
  await assertBranchUnique(
    b.restaurantId,
    input.name && nameKey(input.name) !== b.nameKey ? input.name : undefined,
    input.code && input.code !== b.code ? input.code : undefined,
    b._id,
  );
  b.set(input);
  if (input.name) b.nameKey = nameKey(input.name);
  await b.save();
  await audit(actor, {
    action: 'BRANCH_UPDATED',
    entityType: 'Branch',
    entityId: b._id,
    restaurantId: b.restaurantId,
    branchId: b._id,
    summary:
      Object.keys(input).length === 1 && input.kitchenDisplay !== undefined
        ? `Kitchen Display ${input.kitchenDisplay ? 'on' : 'off'} for branch "${b.name}"`
        : `Updated branch "${b.name}"`,
    meta: { fields: Object.keys(input) },
  });
  return toBranchDTO(b.toObject() as BranchLean);
}

export async function setBranchStatus(actor: AuthUser, id: string, status: RecordStatus) {
  const b = await getBranchOr404(id);
  b.status = status;
  await b.save();
  await audit(actor, {
    action: status === 'ACTIVE' ? 'BRANCH_ACTIVATED' : 'BRANCH_DEACTIVATED',
    entityType: 'Branch',
    entityId: b._id,
    restaurantId: b.restaurantId,
    branchId: b._id,
    summary: `${status === 'ACTIVE' ? 'Activated' : 'Deactivated'} branch "${b.name}"`,
  });
  return toBranchDTO(b.toObject() as BranchLean);
}

// ---------------- Restaurant Admin accounts ----------------

/** Validates branch ids and derives the restaurant ids from them (never trusted from the client). */
async function resolveAssignments(branchIds: string[]) {
  const ids = [...new Set(branchIds)].map((id) => toObjectId(id, 'branch'));
  const branches = await BranchModel.find({ _id: { $in: ids } }).lean<BranchLean[]>();
  if (branches.length !== ids.length) throw badRequest('One or more branches do not exist', 'INVALID_BRANCH');
  const restaurantIds = [...new Map(branches.map((b) => [String(b.restaurantId), b.restaurantId])).values()];
  return { branchIds: branches.map((b) => b._id), restaurantIds };
}

async function getRestaurantAdminOr404(id: string) {
  // Super Admin accounts are deliberately invisible to these endpoints.
  const u = await UserModel.findOne({ _id: toObjectId(id, 'user'), role: { $in: STAFF_ROLES } });
  if (!u) throw notFound('Restaurant Admin');
  return u;
}

/** Audit wording per account type. */
const accountKind = (role: string) => (role === 'KITCHEN' ? { action: 'KITCHEN_LOGIN', label: 'Kitchen login' } : { action: 'RESTAURANT_ADMIN', label: 'Restaurant Admin' });

export async function listRestaurantAdmins(query: { restaurantId?: unknown; status?: unknown }) {
  const filter: Record<string, unknown> = { role: { $in: STAFF_ROLES } };
  if (query.restaurantId) filter.restaurantIds = toObjectId(query.restaurantId, 'restaurant');
  if (query.status === 'ACTIVE' || query.status === 'INACTIVE') filter.status = query.status;
  const users = await UserModel.find(filter).sort({ name: 1 }).lean<AuthUser[]>();
  return users.map(toUserDTO);
}

export async function createRestaurantAdmin(actor: AuthUser, input: UserCreateInput) {
  if (await UserModel.exists({ email: input.email })) throw conflict('This email is already in use', 'DUPLICATE');
  const assignments = await resolveAssignments(input.branchIds);
  const user = await UserModel.create({
    name: input.name,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    role: input.role,
    ...assignments,
  });
  await audit(actor, {
    action: `${accountKind(input.role).action}_CREATED`,
    entityType: 'User',
    entityId: user._id,
    restaurantId: assignments.restaurantIds[0] ?? null,
    summary: `Created ${accountKind(input.role).label} ${user.email}`,
    meta: { branchIds: assignments.branchIds.map(String) },
  });
  return toUserDTO(user.toObject() as unknown as AuthUser);
}

export async function updateRestaurantAdmin(actor: AuthUser, id: string, input: { name?: string; branchIds?: string[] }) {
  const user = await getRestaurantAdminOr404(id);
  const before = user.branchIds.map(String);
  if (input.name) user.name = input.name;
  if (input.branchIds) {
    const a = await resolveAssignments(input.branchIds);
    user.branchIds = a.branchIds as typeof user.branchIds;
    user.restaurantIds = a.restaurantIds as typeof user.restaurantIds;
  }
  await user.save();
  await audit(actor, {
    action: `${accountKind(user.role).action}_${input.branchIds ? 'REASSIGNED' : 'UPDATED'}`,
    entityType: 'User',
    entityId: user._id,
    summary: `Updated ${accountKind(user.role).label} ${user.email}`,
    meta: { before, after: user.branchIds.map(String) },
  });
  return toUserDTO(user.toObject() as unknown as AuthUser);
}

export async function setRestaurantAdminStatus(actor: AuthUser, id: string, status: RecordStatus) {
  const user = await getRestaurantAdminOr404(id);
  user.status = status;
  if (status === 'INACTIVE') user.tokenVersion += 1; // sign out everywhere
  await user.save();
  await audit(actor, {
    action: `${accountKind(user.role).action}_${status === 'ACTIVE' ? 'ACTIVATED' : 'DEACTIVATED'}`,
    entityType: 'User',
    entityId: user._id,
    summary: `${status === 'ACTIVE' ? 'Activated' : 'Deactivated'} ${accountKind(user.role).label} ${user.email}`,
  });
  return toUserDTO(user.toObject() as unknown as AuthUser);
}

export async function resetRestaurantAdminPassword(actor: AuthUser, id: string, password: string) {
  const user = await getRestaurantAdminOr404(id);
  user.passwordHash = await hashPassword(password);
  user.tokenVersion += 1;
  await user.save();
  await audit(actor, {
    action: `${accountKind(user.role).action}_PASSWORD_RESET`,
    entityType: 'User',
    entityId: user._id,
    summary: `Reset password of ${user.email}`,
  });
  return toUserDTO(user.toObject() as unknown as AuthUser);
}
