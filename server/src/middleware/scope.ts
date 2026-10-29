import type { NextFunction, Request, Response } from 'express';
import type { Types } from 'mongoose';
import { BRANCH_HEADER } from '@rb/shared';
import { BranchModel, RestaurantModel, type Branch, type Restaurant } from '../models/index.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { toObjectId } from '../utils/validate.js';
import { currentUser, type AuthUser } from './auth.js';

export type RestaurantLean = Restaurant & { _id: Types.ObjectId };
export type BranchLean = Branch & { _id: Types.ObjectId };

/** The restaurant (and branch, unless managing the shared menu) a request operates on. */
export interface Scope {
  restaurant: RestaurantLean;
  branch: BranchLean | null;
}

export interface BranchScope extends Scope {
  branch: BranchLean;
}

declare module 'express-serve-static-core' {
  interface Request {
    scope?: Scope;
  }
}

const has = (ids: Types.ObjectId[], id: Types.ObjectId) => ids.some((x) => x.equals(id));

export function canAccessBranch(user: AuthUser, branch: Pick<BranchLean, '_id' | 'restaurantId'>): boolean {
  if (user.role === 'SUPER_ADMIN') return true;
  return has(user.branchIds, branch._id) && has(user.restaurantIds, branch.restaurantId);
}

/** Loads a branch and checks the user is allowed to operate it. */
export async function loadBranchScope(user: AuthUser, rawBranchId: unknown): Promise<BranchScope> {
  const branchId = toObjectId(rawBranchId, 'branch');
  const branch = await BranchModel.findById(branchId).lean<BranchLean>();
  const isBranchUser = user.role !== 'SUPER_ADMIN';
  // Branch accounts get 403 for unknown branches too, so ids cannot be probed.
  if (!branch) throw isBranchUser ? forbidden('You are not assigned to this restaurant') : notFound('Branch');
  if (!canAccessBranch(user, branch)) throw forbidden('You are not assigned to this restaurant');
  const restaurant = await RestaurantModel.findById(branch.restaurantId).lean<RestaurantLean>();
  if (!restaurant) throw notFound('Restaurant');
  if (isBranchUser && (branch.status !== 'ACTIVE' || restaurant.status !== 'ACTIVE')) {
    throw forbidden('This restaurant is inactive');
  }
  return { restaurant, branch };
}

function branchIdFrom(req: Request): unknown {
  return req.get(BRANCH_HEADER) || req.query.branchId;
}

/** Requires a concrete branch (billing, tables). */
export async function requireBranchScope(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const raw = branchIdFrom(req);
  if (!raw) throw badRequest('Select a restaurant first', 'BRANCH_REQUIRED');
  req.scope = await loadBranchScope(currentUser(req), raw);
  next();
}

/**
 * Menu scope: a branch, or – for the Super Admin only – a whole restaurant (`restaurantId`
 * query) to manage the shared menu.
 */
export async function requireMenuScope(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const user = currentUser(req);
  const raw = branchIdFrom(req);
  if (raw) {
    req.scope = await loadBranchScope(user, raw);
    return next();
  }
  if (user.role !== 'SUPER_ADMIN') throw badRequest('Select a restaurant first', 'BRANCH_REQUIRED');
  const restaurantId = toObjectId(req.query.restaurantId, 'restaurant');
  const restaurant = await RestaurantModel.findById(restaurantId).lean<RestaurantLean>();
  if (!restaurant) throw notFound('Restaurant');
  req.scope = { restaurant, branch: null };
  next();
}

export function getScope(req: Request): Scope {
  if (!req.scope) throw badRequest('Select a restaurant first', 'BRANCH_REQUIRED');
  return req.scope;
}

export function getBranchScope(req: Request): BranchScope {
  const scope = getScope(req);
  if (!scope.branch) throw badRequest('Select a restaurant first', 'BRANCH_REQUIRED');
  return scope as BranchScope;
}
