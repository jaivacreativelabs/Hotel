import { Types } from 'mongoose';
import type { z } from 'zod';
import { AppError } from './errors.js';

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    const first = details[0];
    const message = first ? `${first.path ? `${first.path}: ` : ''}${first.message}` : 'Invalid request';
    throw new AppError(400, 'VALIDATION_ERROR', message, details);
  }
  return result.data;
}

export function toObjectId(value: unknown, label = 'id'): Types.ObjectId {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) {
    throw new AppError(400, 'INVALID_ID', `Invalid ${label}`);
  }
  return new Types.ObjectId(value);
}

export const idStr = (id: Types.ObjectId | string | null | undefined): string | null =>
  id == null ? null : String(id);

/** Lower-cased, whitespace-collapsed key used for case-insensitive uniqueness. */
export const nameKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
