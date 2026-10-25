// Vercel serverless entry: every /api/* and /uploads/* request is handled by the Express app.
// The compiled server (server/dist) is produced by `npm run build` before functions are bundled.
import { createApp } from '../server/dist/app.js';
import { connectDatabase } from '../server/dist/config/db.js';

const app = createApp();
let ready = null;

export default async function handler(req, res) {
  // One connection per warm instance; retried on the next request if it failed.
  ready ??= connectDatabase().catch((err) => {
    ready = null;
    throw err;
  });
  try {
    await ready;
  } catch (err) {
    console.error('[db] connection failed', err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'DB_UNAVAILABLE', message: 'Database is not reachable. Please try again.' } }));
    return;
  }
  return app(req, res);
}
