import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Types } from 'mongoose';
import type { RecordStatus, Role } from '@rb/shared';
import { env } from '../config/env.js';
import { UserModel } from '../models/index.js';
import { forbidden, unauthenticated } from '../utils/errors.js';

export const SESSION_COOKIE = 'rb_session';

export interface AuthUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: Role;
  status: RecordStatus;
  restaurantIds: Types.ObjectId[];
  branchIds: Types.ObjectId[];
  tokenVersion: number;
  lastLoginAt?: Date | null;
  createdAt?: Date;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

interface SessionClaims {
  sub: string;
  tv: number;
  /** issued at (seconds), added by jsonwebtoken */
  iat?: number;
}

/**
 * A session lasts SESSION_TTL_HOURS from its last use, not from sign-in: a counter tablet signed
 * in in the morning was signed out mid-service in the evening. While in use the cookie is renewed
 * (at most once every RENEW_AFTER_S), so only a device left unused is signed out.
 */
const RENEW_AFTER_S = 15 * 60;

/**
 * Who a session cookie belongs to (account + sign-in generation), or null when it is not ours.
 * Unlike the cookie text it stays the same when the cookie is renewed.
 */
export function sessionOwner(token: unknown): string | null {
  if (typeof token !== 'string' || !token) return null;
  try {
    const c = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], ignoreExpiration: true }) as unknown as SessionClaims;
    return `${c.sub}.${c.tv}`;
  } catch {
    return null;
  }
}

export function issueSession(res: Response, user: Pick<AuthUser, '_id' | 'tokenVersion'>): void {
  const token = jwt.sign({ sub: String(user._id), tv: user.tokenVersion } satisfies SessionClaims, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: Math.round(env.SESSION_TTL_HOURS * 3600),
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.COOKIE_SECURE,
    path: '/',
    maxAge: env.SESSION_TTL_HOURS * 3600 * 1000,
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: env.COOKIE_SECURE, path: '/' });
}

/** Verifies the session cookie and reloads the user from MongoDB on every request. */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || !token) throw unauthenticated();
  let claims: SessionClaims;
  try {
    claims = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as unknown as SessionClaims;
  } catch {
    clearSession(res);
    throw unauthenticated('Your session has expired. Please sign in again.');
  }
  const user = await UserModel.findById(claims.sub).lean<AuthUser>();
  if (!user || user.status !== 'ACTIVE' || user.tokenVersion !== claims.tv) {
    clearSession(res);
    throw unauthenticated('Your session is no longer valid. Please sign in again.');
  }
  // Kitchen logins may only use the kitchen board and their own session – everything else is
  // refused here, whatever a route would otherwise allow.
  if (user.role === 'KITCHEN' && !KITCHEN_ROUTES.some((r) => req.baseUrl.endsWith(r))) {
    throw forbidden('Kitchen logins can only open the Kitchen Display');
  }
  // Waiter logins likewise: only the Waiter board.
  if (user.role === 'WAITER' && !WAITER_ROUTES.some((r) => req.baseUrl.endsWith(r))) {
    throw forbidden('Waiter logins can only open the Waiter board');
  }
  if (!claims.iat || Date.now() / 1000 - claims.iat > RENEW_AFTER_S) issueSession(res, user);
  req.user = user;
  next();
}

const KITCHEN_ROUTES = ['/kitchen', '/auth'];
const WAITER_ROUTES = ['/waiter', '/auth'];

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthenticated();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthenticated();
  return req.user;
}
