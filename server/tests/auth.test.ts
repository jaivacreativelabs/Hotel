import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { UserModel } from '../src/models/index.js';
import { login } from '../src/services/auth.service.js';
import { app, Client, createSuperAdmin, ok, PASSWORD, useTestDatabase } from './helpers.js';

useTestDatabase();

describe('authentication', () => {
  it('logs in a Super Admin and returns the profile', async () => {
    const sa = await createSuperAdmin();
    const me = ok<{ user: { role: string; email: string } }>(await sa.get('/api/v1/auth/me'));
    expect(me.user.role).toBe('SUPER_ADMIN');
    expect(me.user).not.toHaveProperty('passwordHash');
  });

  it('logs in a Restaurant Admin with its branches', async () => {
    const sa = await new Client().login('super@test.local');
    const r = ok<{ id: string }>(await sa.post('/api/v1/admin/restaurants', { name: 'R1' }), 201);
    const b = ok<{ id: string }>(await sa.post('/api/v1/admin/branches', { restaurantId: r.id, name: 'Main', code: 'M' }), 201);
    ok(await sa.post('/api/v1/admin/users', { name: 'RA', email: 'ra@test.local', password: PASSWORD, branchIds: [b.id] }), 201);
    const ra = await new Client().login('ra@test.local');
    const me = ok<{ user: { role: string }; branches: { id: string }[] }>(await ra.get('/api/v1/auth/me'));
    expect(me.user.role).toBe('RESTAURANT_ADMIN');
    expect(me.branches.map((x) => x.id)).toEqual([b.id]);
  });

  it('rejects wrong passwords and unknown emails with the same message', async () => {
    const c = new Client();
    const wrong = await c.post('/api/v1/auth/login', { email: 'super@test.local', password: 'nope-nope1' });
    const unknown = await c.post('/api/v1/auth/login', { email: 'ghost@test.local', password: 'nope-nope1' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('requires a session for protected routes', async () => {
    const res = await new Client().get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect((await new Client().get('/api/v1/transactions')).status).toBe(401);
  });

  it('blocks state-changing requests without the client header (CSRF)', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'super@test.local', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF');
  });

  it('blocks a foreign Origin', async () => {
    const res = await new Client()
      .post('/api/v1/auth/login', { email: 'super@test.local', password: PASSWORD })
      .set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('kills existing sessions when an admin is deactivated', async () => {
    const sa = await new Client().login('super@test.local');
    const ra = await new Client().login('ra@test.local');
    const user = await UserModel.findOne({ email: 'ra@test.local' });
    ok(await sa.patch(`/api/v1/admin/users/${user!._id}/status`, { status: 'INACTIVE' }));
    expect((await ra.get('/api/v1/auth/me')).status).toBe(401);
    const relogin = await new Client().post('/api/v1/auth/login', { email: 'ra@test.local', password: PASSWORD });
    expect(relogin.status).toBe(403);
    ok(await sa.patch(`/api/v1/admin/users/${user!._id}/status`, { status: 'ACTIVE' }));
  });

  it('never lets a user change a role through the API', async () => {
    const sa = await new Client().login('super@test.local');
    const user = await UserModel.findOne({ email: 'ra@test.local' });
    const res = await sa.patch(`/api/v1/admin/users/${user!._id}`, { role: 'SUPER_ADMIN' });
    expect(res.status).toBe(400);
    const create = await sa.post('/api/v1/admin/users', {
      name: 'X',
      email: 'x@test.local',
      password: PASSWORD,
      branchIds: user!.branchIds.map(String),
      role: 'SUPER_ADMIN',
    });
    expect(create.status).toBe(400);
    expect((await UserModel.findById(user!._id))!.role).toBe('RESTAURANT_ADMIN');
    // Super Admin accounts are invisible to the user-management API.
    const superUser = await UserModel.findOne({ role: 'SUPER_ADMIN' });
    expect((await sa.patch(`/api/v1/admin/users/${superUser!._id}`, { name: 'Hacked' })).status).toBe(404);
  });

  it('changes the password and revokes other sessions', async () => {
    const first = await new Client().login('ra@test.local');
    const second = await new Client().login('ra@test.local');
    ok(await first.post('/api/v1/auth/change-password', { currentPassword: PASSWORD, newPassword: 'NewPassw0rd' }));
    expect((await first.get('/api/v1/auth/me')).status).toBe(200);
    expect((await second.get('/api/v1/auth/me')).status).toBe(401);
    ok(await first.post('/api/v1/auth/change-password', { currentPassword: 'NewPassw0rd', newPassword: PASSWORD }));
  });

  it('locks an account after too many wrong passwords, on every server instance', async () => {
    // The service directly: the lock lives in MongoDB, not in one instance's per-IP limiter.
    for (let i = 0; i < Number(process.env.LOGIN_RATE_LIMIT_MAX); i++) {
      await expect(login('ra@test.local', `wrong-${i}a`)).rejects.toMatchObject({ status: 401 });
    }
    // Locked: even the right password is refused.
    await expect(login('ra@test.local', PASSWORD)).rejects.toMatchObject({ status: 429, code: 'ACCOUNT_LOCKED' });
    // A Super Admin resetting the password lifts the lock.
    const sa = await new Client().login('super@test.local');
    const ra = ok<{ id: string; email: string }[]>(await sa.get('/api/v1/admin/users')).find((u) => u.email === 'ra@test.local')!;
    ok(await sa.post(`/api/v1/admin/users/${ra.id}/reset-password`, { password: PASSWORD }));
    await expect(login('ra@test.local', PASSWORD)).resolves.toMatchObject({ email: 'ra@test.local' });
    expect(await UserModel.findOne({ email: 'ra@test.local' }).lean()).toMatchObject({ loginFails: 0, lockedUntil: null });
  });

  it('rate-limits repeated failed logins', async () => {
    const c = new Client();
    let last = 0;
    for (let i = 0; i < 25; i++) {
      last = (await c.post('/api/v1/auth/login', { email: 'super@test.local', password: `wrong-${i}a` })).status;
    }
    expect(last).toBe(429);
  });
});
