import mongoose from 'mongoose';
import { env } from './env.js';

let transactionsSupported = false;
let stopMemoryDb: (() => Promise<void>) | null = null;

export function supportsTransactions(): boolean {
  return transactionsSupported;
}

export async function connectDatabase(uri = env.MONGODB_URI): Promise<void> {
  let target = uri;
  if (uri === 'memory') {
    if (env.isProd) throw new Error('MONGODB_URI=memory is only allowed outside production');
    const { startDevMemoryDb } = await import('./memoryDb.js');
    const started = await startDevMemoryDb();
    target = started.uri;
    stopMemoryDb = started.stop;
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(target, { serverSelectionTimeoutMS: 15_000 });
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  transactionsSupported = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  // Build indexes up-front: unique indexes are part of the duplicate-bill protection.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  if (!transactionsSupported && !env.isTest) {
    console.warn(
      '[db] MongoDB is not a replica set – multi-document transactions are disabled. ' +
        'Unique indexes still prevent duplicate bills. Use MongoDB Atlas or a replica set in production.',
    );
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  if (stopMemoryDb) await stopMemoryDb();
}
