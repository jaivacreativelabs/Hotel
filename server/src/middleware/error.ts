import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { AppError } from '../utils/errors.js';

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof multer.MulterError) {
    return err.code === 'LIMIT_FILE_SIZE'
      ? new AppError(413, 'FILE_TOO_LARGE', 'Image must be 2 MB or smaller')
      : new AppError(400, 'BAD_UPLOAD', 'Invalid upload');
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    return new AppError(400, 'VALIDATION_ERROR', details[0]?.message ?? 'Invalid data', details);
  }
  if (err instanceof mongoose.Error.CastError) return new AppError(400, 'INVALID_ID', 'Invalid id');
  const e = err as { code?: number; type?: string; keyPattern?: Record<string, unknown> };
  if (e?.code === 11000) {
    const field = Object.keys(e.keyPattern ?? {}).filter((k) => !k.endsWith('Id'))[0] ?? 'value';
    const label = field.replace(/Key$/, '');
    return new AppError(409, 'DUPLICATE', `A record with this ${label} already exists`);
  }
  if (e?.type === 'entity.parse.failed') return new AppError(400, 'BAD_JSON', 'Malformed JSON body');
  if (e?.type === 'entity.too.large') return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  return new AppError(500, 'INTERNAL', 'Something went wrong. Please try again.');
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const appErr = toAppError(err);
  if (appErr.status >= 500) {
    // Full detail goes to the server log only – never to the client.
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }
  res.status(appErr.status).json({
    error: { code: appErr.code, message: appErr.message, ...(appErr.details !== undefined && { details: appErr.details }) },
  });
}

export function apiNotFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'NOT_FOUND', 'Endpoint not found'));
}
