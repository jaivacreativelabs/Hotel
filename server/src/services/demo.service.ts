/**
 * Demo sign-in buttons. The Super Admin marks accounts as "demo" in MongoDB; the login page
 * lists them and a tap signs in without a password. Nothing secret is stored or sent – the
 * server simply issues the session while the account's demo flag is on. Turning the flag off
 * takes effect immediately.
 */
import type { Types } from 'mongoose';
import type { AdminDemoAccountDTO, DemoAccountDTO, RecordStatus, Role } from '@rb/shared';
import type { AuthUser } from '../middleware/auth.js';
import { BranchModel, RestaurantModel, UserModel } from '../models/index.js';
import { forbidden, notFound } from '../utils/errors.js';
import { toObjectId } from '../utils/validate.js';
import { audit } from './audit.service.js';

interface DemoUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: Role;
  status: RecordStatus;
  branchIds: Types.ObjectId[];
  demo?: { enabled?: boolean; label?: string };
  createdAt?: Date;
}

async function hints(users: DemoUser[]): Promise<Map<string, string>> {
  const branchIds = users.flatMap((u) => u.branchIds);
  const branches = await BranchModel.find({ _id: { $in: branchIds } })
    .select('name')
    .lean<{ _id: Types.ObjectId; name: string }[]>();
  const branchName = new Map(branches.map((b) => [String(b._id), b.name]));
  return new Map(
    users.map((u) => [
      String(u._id),
      u.role === 'SUPER_ADMIN'
        ? 'All branches, reports, analytics'
        : `Only ${u.branchIds.map((id) => branchName.get(String(id)) ?? 'branch').join(', ')}`,
    ]),
  );
}

const labelOf = (u: DemoUser) => u.demo?.label || u.name;

/** Branch ids that are active and belong to an active restaurant. */
async function usableBranchIds(branchIds: Types.ObjectId[]): Promise<Set<string>> {
  const branches = await BranchModel.find({ _id: { $in: branchIds }, status: 'ACTIVE' })
    .select('restaurantId')
    .lean<{ _id: Types.ObjectId; restaurantId: Types.ObjectId }[]>();
  const restaurants = await RestaurantModel.find({ _id: { $in: branches.map((b) => b.restaurantId) }, status: 'ACTIVE' })
    .select('_id')
    .lean<{ _id: Types.ObjectId }[]>();
  const activeRestaurants = new Set(restaurants.map((r) => String(r._id)));
  return new Set(branches.filter((b) => activeRestaurants.has(String(b.restaurantId))).map((b) => String(b._id)));
}

/** Public list for the login page. Branch admins whose branch is inactive are left out. */
export async function listPublicDemoAccounts(): Promise<DemoAccountDTO[]> {
  const enabled = await UserModel.find({ 'demo.enabled': true, status: 'ACTIVE' })
    .select('name role branchIds demo')
    .lean<DemoUser[]>();
  const usable = await usableBranchIds(enabled.flatMap((u) => u.branchIds));
  const users = enabled.filter((u) => u.role === 'SUPER_ADMIN' || u.branchIds.some((id) => usable.has(String(id))));
  // Super Admin first, then by label.
  users.sort((a, b) => (a.role === b.role ? labelOf(a).localeCompare(labelOf(b)) : a.role === 'SUPER_ADMIN' ? -1 : 1));
  const h = await hints(users);
  return users.map((u) => ({ id: String(u._id), label: labelOf(u), role: u.role, hint: h.get(String(u._id)) ?? '' }));
}

/** Signs in as a demo account – only while its demo flag is on and the account is active. */
export async function demoLogin(userId: string): Promise<AuthUser> {
  const user = await UserModel.findById(toObjectId(userId, 'account')).lean<AuthUser & DemoUser>();
  if (!user || !user.demo?.enabled) throw forbidden('This demo login is not available');
  if (user.status !== 'ACTIVE') throw forbidden('This account has been deactivated');
  await UserModel.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  await audit(user, {
    action: 'DEMO_LOGIN',
    entityType: 'User',
    entityId: user._id,
    summary: `Signed in with the demo button as ${user.email}`,
  });
  return user;
}

/** Super Admin: every account (including Super Admins) with its demo setting. */
export async function listDemoSettings(): Promise<AdminDemoAccountDTO[]> {
  const users = await UserModel.find().select('name email role status branchIds demo createdAt').sort({ role: -1, name: 1 }).lean<DemoUser[]>();
  const h = await hints(users);
  return users.map((u) => ({
    id: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    label: labelOf(u),
    hint: h.get(String(u._id)) ?? '',
    demoEnabled: Boolean(u.demo?.enabled),
    demoLabel: u.demo?.label ?? '',
  }));
}

export async function updateDemoSetting(actor: AuthUser, userId: string, input: { enabled: boolean; label?: string }) {
  const user = await UserModel.findById(toObjectId(userId, 'account'));
  if (!user) throw notFound('Account');
  const before = { enabled: Boolean(user.demo?.enabled), label: user.demo?.label ?? '' };
  user.set('demo.enabled', input.enabled);
  if (input.label !== undefined) user.set('demo.label', input.label);
  await user.save();
  await audit(actor, {
    action: input.enabled ? 'DEMO_LOGIN_ENABLED' : 'DEMO_LOGIN_DISABLED',
    entityType: 'User',
    entityId: user._id,
    summary: `${input.enabled ? 'Showed' : 'Hid'} demo login button for ${user.email}`,
    meta: { before, after: input },
  });
  return (await listDemoSettings()).find((u) => u.id === String(user._id))!;
}
