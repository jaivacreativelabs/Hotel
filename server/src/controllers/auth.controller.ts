import type { Request, Response } from 'express';
import { changePasswordSchema, loginSchema } from '@rb/shared';
import { clearSession, currentUser, issueSession } from '../middleware/auth.js';
import * as authService from '../services/auth.service.js';
import { parse } from '../utils/validate.js';

export async function login(req: Request, res: Response) {
  const { email, password } = parse(loginSchema, req.body);
  const user = await authService.login(email, password);
  issueSession(res, user);
  res.json({ data: await authService.me(user) });
}

export function logout(_req: Request, res: Response) {
  clearSession(res);
  res.json({ data: { ok: true } });
}

export async function me(req: Request, res: Response) {
  res.json({ data: await authService.me(currentUser(req)) });
}

export async function changePassword(req: Request, res: Response) {
  const input = parse(changePasswordSchema, req.body);
  const user = await authService.changePassword(currentUser(req), input.currentPassword, input.newPassword);
  issueSession(res, user); // other sessions are revoked, this one continues
  res.json({ data: { ok: true } });
}
