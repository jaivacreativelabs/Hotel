import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { RestaurantModel, UserModel } from '../src/models/index.js';
import { app, createSuperAdmin, useTestDatabase } from './helpers.js';

useTestDatabase();

const HOUR = 3600;
/** A session cookie as the server would have issued it `ageS` seconds ago. */
async function sessionIssuedAgo(email: string, ageS: number): Promise<string> {
  const user = await UserModel.findOne({ email }).lean();
  const iat = Math.floor(Date.now() / 1000) - ageS;
  return jwt.sign({ sub: String(user!._id), tv: user!.tokenVersion, iat, exp: iat + env.SESSION_TTL_HOURS * HOUR }, env.JWT_SECRET, { algorithm: 'HS256' });
}
const newCookie = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) => c.startsWith('rb_session=') && !c.startsWith('rb_session=;'));
const claimsOf = (cookie: string) => jwt.decode(cookie.slice('rb_session='.length).split(';')[0]) as { iat: number; exp: number };
const me = (token: string) => request(app).get('/api/v1/auth/me').set('Cookie', `rb_session=${token}`);

describe('a session in use stays signed in', () => {
  it('is renewed while used, so it ends SESSION_TTL_HOURS after the last use, not after sign-in', async () => {
    await createSuperAdmin();
    // Signed in nearly a whole session ago (morning) and still billing (evening).
    const res = await me(await sessionIssuedAgo('super@test.local', env.SESSION_TTL_HOURS * HOUR - 60));
    expect(res.status).toBe(200);
    const cookie = newCookie(res);
    expect(cookie).toBeDefined();
    expect(claimsOf(cookie!).exp - Date.now() / 1000).toBeGreaterThan(env.SESSION_TTL_HOURS * HOUR - 120);
  });

  it('is not reissued on every request', async () => {
    const res = await me(await sessionIssuedAgo('super@test.local', 60));
    expect(res.status).toBe(200);
    expect(newCookie(res)).toBeUndefined();
  });

  it('still ends for a device left unused for SESSION_TTL_HOURS', async () => {
    expect((await me(await sessionIssuedAgo('super@test.local', env.SESSION_TTL_HOURS * HOUR + 60))).status).toBe(401);
  });

  it('a save retried with the renewed cookie gets its first answer instead of saving twice', async () => {
    const before = await sessionIssuedAgo('super@test.local', HOUR);
    const after = await sessionIssuedAgo('super@test.local', 0);
    const send = (cookie: string) =>
      request(app)
        .post('/api/v1/admin/restaurants')
        .set('Cookie', `rb_session=${cookie}`)
        .set('X-Requested-With', 'rb-client')
        .set('Idempotency-Key', 'rq_renewed_cookie_key_001')
        .send({ name: 'Renewed Cookie Cafe' });
    const first = await send(before);
    const again = await send(after);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(await RestaurantModel.countDocuments({ name: 'Renewed Cookie Cafe' })).toBe(1);
  });
});
