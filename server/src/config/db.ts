import mongoose from 'mongoose';
import { env } from './env.js';

let transactionsSupported = false;
let stopMemoryDb: (() => Promise<void>) | null = null;

export function supportsTransactions(): boolean {
  return transactionsSupported;
}

/**
 * Vercel freezes the function between requests. Atlas closes connections that sat idle meanwhile,
 * and on waking the old sockets look alive: a query on one hung until Vercel cut the request off
 * at 30 s (logs: "secureConnect timed out after 159562ms", "socket has been ended by the other
 * party"), so for a while nothing loaded or saved. Connections idle for a minute are thrown away
 * instead of reused (the frozen time counts as idle), and a dead socket fails within 20 s, inside
 * the 30 s limit, so the driver retries on a fresh connection and the request still answers.
 */
const SERVERLESS_OPTIONS = {
  serverSelectionTimeoutMS: 8_000,
  connectTimeoutMS: 8_000,
  socketTimeoutMS: 20_000,
  maxIdleTimeMS: 60_000,
  // Many short-lived instances share the cluster's connection limit (500 on the free tier).
  maxPoolSize: 10,
} as const;

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
  await mongoose.connect(target, process.env.VERCEL ? SERVERLESS_OPTIONS : { serverSelectionTimeoutMS: 15_000 });
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  transactionsSupported = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  // Build indexes up-front: unique indexes are part of the duplicate-bill protection. On Vercel
  // they exist after the first deploy, so a cold start does not wait for the check (it costs a
  // round trip per index before the first request could be answered).
  const indexes = Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  if (process.env.VERCEL) indexes.catch((err) => console.error('[db] index build failed', err));
  else await indexes;
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
