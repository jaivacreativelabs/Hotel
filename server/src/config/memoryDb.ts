/**
 * Development-only database: `MONGODB_URI=memory` starts a single-node replica set with
 * data persisted in server/.data/db, so the app runs without installing MongoDB.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { serverRoot } from './env.js';

export async function startDevMemoryDb(): Promise<{ uri: string; stop: () => Promise<void> }> {
  const dbPath = path.join(serverRoot, '.data', 'db');
  fs.mkdirSync(dbPath, { recursive: true });
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger', name: 'rb-dev' },
    instanceOpts: [{ dbPath, port: 27027 }],
  });
  const uri = replSet.getUri('restaurant_billing');
  console.log(`[db] Development in-memory MongoDB replica set (data in ${dbPath})`);
  return {
    uri,
    stop: async () => {
      await replSet.stop({ doCleanup: false });
    },
  };
}
