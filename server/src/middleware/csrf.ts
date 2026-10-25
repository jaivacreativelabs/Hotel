import type { NextFunction, Request, Response } from 'express';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@rb/shared';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defence in depth on top of the SameSite=Strict cookie: state-changing requests must carry a
 * custom header (which cross-site forms cannot send without a CORS preflight) and, when the
 * browser sends an Origin, it must be ours.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE.has(req.method)) return next();
  if (req.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
    throw new AppError(403, 'CSRF', 'Request blocked: missing client header');
  }
  const origin = req.get('origin');
  if (origin) {
    let host = '';
    try {
      host = new URL(origin).host;
    } catch {
      throw new AppError(403, 'CSRF', 'Request blocked: bad origin');
    }
    if (host !== req.get('host') && !env.corsOrigins.includes(origin)) {
      throw new AppError(403, 'CSRF', 'Request blocked: origin not allowed');
    }
  }
  next();
}
