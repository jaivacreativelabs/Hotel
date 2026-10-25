import mongoose, { type ClientSession } from 'mongoose';
import { supportsTransactions } from './db.js';

/**
 * Runs `fn` inside a MongoDB transaction when the deployment supports it (replica set /
 * Atlas). On a standalone server `fn` runs without a session; callers rely on unique
 * indexes for duplicate protection in that mode.
 */
export async function runInTransaction<T>(fn: (session: ClientSession | undefined) => Promise<T>): Promise<T> {
  if (!supportsTransactions()) return fn(undefined);
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}
