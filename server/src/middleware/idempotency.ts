import type { NextFunction, Request, Response } from 'express';
import { REQUEST_KEY_HEADER } from '@rb/shared';
import { RequestLogModel } from '../models/index.js';
import { AppError } from '../utils/errors.js';

const KEY = /^[A-Za-z0-9_-]{16,100}$/;
/** Longer than any request may run (Vercel maxDuration 30 s): such a save was cut off. */
const ABANDONED_MS = 60_000;
const WAIT_MS = 10_000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Makes a save safe to send again. The app retries a request whose answer never arrived (a
 * dropped connection or Wi-Fi), and it may have reached the server already: with the same
 * key, the server sends the first answer instead of saving twice. Sign-in is left out – it
 * sets the session cookie and is safe to repeat anyway.
 */
export async function repeatSafe(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.get(REQUEST_KEY_HEADER);
  if (!key || req.method === 'GET' || req.method === 'HEAD' || req.path.startsWith('/auth/')) return next();
  if (!KEY.test(key)) throw new AppError(400, 'BAD_REQUEST_KEY', 'Invalid request key');
  const fingerprint = `${req.method} ${req.originalUrl}`;

  try {
    await RequestLogModel.create({ _id: key, fingerprint });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) return next(); // cannot record it: just handle the request
    return replay(key, fingerprint, res, next);
  }
  record(key, res);
  next();
}

/** Stores the answer before it is sent (a serverless function may stop right after sending). */
function record(key: string, res: Response) {
  const end = res.end.bind(res) as (...args: unknown[]) => Response;
  res.end = ((...args: unknown[]) => {
    const chunk = typeof args[0] === 'function' ? undefined : args[0];
    // A server error is not kept: a retry should run the save again.
    const saved =
      res.statusCode >= 500
        ? RequestLogModel.deleteOne({ _id: key })
        : RequestLogModel.updateOne(
            { _id: key },
            {
              $set: {
                done: true,
                status: res.statusCode,
                contentType: String(res.getHeader('Content-Type') ?? ''),
                body: chunk === undefined || chunk === null ? '' : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk),
              },
            },
          );
    saved
      .catch((err: unknown) => console.error('[request-log] could not store the answer:', err))
      .finally(() => end(...args));
    return res;
  }) as Response['end'];
}

async function replay(key: string, fingerprint: string, res: Response, next: NextFunction) {
  const until = Date.now() + WAIT_MS;
  for (;;) {
    const log = await RequestLogModel.findById(key).lean();
    if (!log) {
      // Removed meanwhile (the first try failed on the server): run it now.
      return repeatSafe(res.req, res, next);
    }
    if (log.fingerprint !== fingerprint) throw new AppError(422, 'BAD_REQUEST_KEY', 'This request key belongs to another request');
    if (log.done) {
      res.setHeader('Idempotent-Replayed', 'true');
      if (log.contentType) res.setHeader('Content-Type', log.contentType);
      res.status(log.status ?? 200).end(log.body || undefined);
      return;
    }
    if (Date.now() - log.createdAt.getTime() > ABANDONED_MS) {
      await RequestLogModel.deleteOne({ _id: key, done: false });
      return repeatSafe(res.req, res, next);
    }
    // The first try is still running: wait for its answer.
    if (Date.now() > until) throw new AppError(409, 'REQUEST_IN_PROGRESS', 'Still saving – please wait a moment and check');
    await wait(250);
  }
}
