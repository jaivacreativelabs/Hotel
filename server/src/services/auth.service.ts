import bcrypt from 'bcryptjs';
import type { BranchContextDTO, MeDTO } from '@rb/shared';
import type { AuthUser } from '../middleware/auth.js';
import type { BranchLean, RestaurantLean } from '../middleware/scope.js';
import { BranchModel, RestaurantModel, UserModel } from '../models/index.js';
import { AppError, unauthenticated } from '../utils/errors.js';
import { restaurantSettings, toUserDTO } from '../utils/serialize.js';

const BCRYPT_COST = 12;
// Compared against when the email is unknown so both paths take the same time.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_COST);

export async function login(email: string, password: string): Promise<AuthUser> {
  const user = await UserModel.findOne({ email }).select('+passwordHash').lean<AuthUser & { passwordHash: string }>();
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthenticated('Invalid email or password');
  if (user.status !== 'ACTIVE') throw new AppError(403, 'ACCOUNT_INACTIVE', 'Your account has been deactivated');
  await UserModel.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  const { passwordHash: _omit, ...safe } = user;
  return safe;
}

export async function changePassword(user: AuthUser, currentPassword: string, newPassword: string): Promise<AuthUser> {
  const doc = await UserModel.findById(user._id).select('+passwordHash');
  if (!doc || !(await bcrypt.compare(currentPassword, doc.passwordHash))) {
    throw new AppError(400, 'WRONG_PASSWORD', 'Current password is incorrect');
  }
  doc.passwordHash = await hashPassword(newPassword);
  doc.tokenVersion += 1;
  await doc.save();
  return doc.toObject() as unknown as AuthUser;
}

/** Branches the user may operate (Restaurant Admin) – active branch + active restaurant only. */
export async function accessibleBranches(user: AuthUser): Promise<BranchContextDTO[]> {
  if (user.role !== 'RESTAURANT_ADMIN' || user.branchIds.length === 0) return [];
  const branches = await BranchModel.find({
    _id: { $in: user.branchIds },
    restaurantId: { $in: user.restaurantIds },
    status: 'ACTIVE',
  })
    .sort({ name: 1 })
    .lean<BranchLean[]>();
  const restaurants = await RestaurantModel.find({
    _id: { $in: branches.map((b) => b.restaurantId) },
    status: 'ACTIVE',
  }).lean<RestaurantLean[]>();
  const byId = new Map(restaurants.map((r) => [String(r._id), r]));
  return branches
    .filter((b) => byId.has(String(b.restaurantId)))
    .map((b) => {
      const r = byId.get(String(b.restaurantId))!;
      return {
        id: String(b._id),
        name: b.name,
        code: b.code,
        kitchenDisplay: b.kitchenDisplay ?? false,
        restaurant: { id: String(r._id), name: r.name, settings: restaurantSettings(r) },
      };
    });
}

export async function me(user: AuthUser): Promise<MeDTO> {
  return { user: toUserDTO(user), branches: await accessibleBranches(user) };
}
