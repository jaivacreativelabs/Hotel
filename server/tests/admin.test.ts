import { beforeAll, describe, expect, it } from 'vitest';
import { AuditLogModel } from '../src/models/index.js';
import { buildWorld, Client, ok, PASSWORD, useTestDatabase, type World } from './helpers.js';

useTestDatabase();

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});

describe('Super Admin – restaurants and branches', () => {
  it('lists restaurants with branch counts', async () => {
    const list = ok<{ name: string; branchCount: number }[]>(await w.sa.get('/api/v1/admin/restaurants'));
    // Main Branch (created automatically) + A1 + A2
    expect(list.find((r) => r.name === 'Restaurant A')?.branchCount).toBe(3);
  });

  it('creates a Main Branch automatically with the restaurant', async () => {
    const r = ok<{ id: string; branchCount: number; mainBranchId: string }>(
      await w.sa.post('/api/v1/admin/restaurants', { name: 'Restaurant C', phone: '+91 99999 00000', address: 'Madurai' }),
      201,
    );
    expect(r.branchCount).toBe(1);
    const d = ok<{ branches: { id: string; name: string; code: string; phone: string; address: string; status: string }[] }>(
      await w.sa.get(`/api/v1/admin/restaurants/${r.id}`),
    );
    expect(d.branches).toEqual([
      expect.objectContaining({ id: r.mainBranchId, name: 'Main Branch', code: 'MAIN', phone: '+91 99999 00000', address: 'Madurai', status: 'ACTIVE' }),
    ]);
    // Ready to use straight away: an admin can be assigned to it.
    ok(await w.sa.post('/api/v1/admin/users', { name: 'C Admin', email: 'c@test.local', password: 'Passw0rd!', branchIds: [r.mainBranchId] }), 201);
  });

  it('rejects duplicate restaurant names (case-insensitive)', async () => {
    const res = await w.sa.post('/api/v1/admin/restaurants', { name: 'restaurant a' });
    expect(res.status).toBe(409);
  });

  it('rejects duplicate branch codes in the same restaurant', async () => {
    const res = await w.sa.post('/api/v1/admin/branches', { restaurantId: w.restaurantA, name: 'Other', code: 'a1' });
    expect(res.status).toBe(409);
  });

  it('edits a restaurant and its tax settings', async () => {
    const r = ok<{ address: string }>(await w.sa.patch(`/api/v1/admin/restaurants/${w.restaurantB}`, { address: 'New St' }));
    expect(r.address).toBe('New St');
    const s = ok<{ settings: { taxes: unknown[] } }>(
      await w.sa.patch(`/api/v1/admin/restaurants/${w.restaurantB}/settings`, {
        taxes: [{ name: 'GST', rateBps: 500 }],
        pricesIncludeTax: false,
        receiptFooter: 'Thanks',
      }),
    );
    expect(s.settings.taxes).toHaveLength(1);
  });

  it('shows restaurant detail with branches and admins', async () => {
    const d = ok<{ branches: unknown[]; admins: { email: string }[] }>(await w.sa.get(`/api/v1/admin/restaurants/${w.restaurantA}`));
    expect(d.branches).toHaveLength(3);
    expect(d.admins.map((a) => a.email).sort()).toEqual(['a1@test.local', 'a2@test.local']);
  });

  it('deactivating a branch blocks its Restaurant Admin', async () => {
    ok(await w.sa.patch(`/api/v1/admin/branches/${w.branchA2}/status`, { status: 'INACTIVE' }));
    expect((await w.adminA2.get('/api/v1/tables')).status).toBe(403);
    ok(await w.sa.patch(`/api/v1/admin/branches/${w.branchA2}/status`, { status: 'ACTIVE' }));
    expect((await w.adminA2.get('/api/v1/tables')).status).toBe(200);
  });

  it('deactivating a restaurant blocks all of its branches', async () => {
    ok(await w.sa.patch(`/api/v1/admin/restaurants/${w.restaurantB}/status`, { status: 'INACTIVE' }));
    expect((await w.adminB1.get('/api/v1/tables')).status).toBe(403);
    ok(await w.sa.patch(`/api/v1/admin/restaurants/${w.restaurantB}/status`, { status: 'ACTIVE' }));
  });
});

describe('Super Admin – Restaurant Admin accounts', () => {
  it('creates, reassigns and isolates a Restaurant Admin', async () => {
    const created = ok<{ id: string; restaurantIds: string[]; role: string }>(
      await w.sa.post('/api/v1/admin/users', { name: 'Moving', email: 'move@test.local', password: PASSWORD, branchIds: [w.branchA1] }),
      201,
    );
    expect(created.role).toBe('RESTAURANT_ADMIN');
    expect(created.restaurantIds).toEqual([w.restaurantA]);

    const ra = (await new Client().login('move@test.local')).useBranch(w.branchA1);
    expect((await ra.get('/api/v1/tables')).status).toBe(200);
    expect((await ra.useBranch(w.branchB1).get('/api/v1/tables')).status).toBe(403);

    const moved = ok<{ restaurantIds: string[] }>(await w.sa.patch(`/api/v1/admin/users/${created.id}`, { branchIds: [w.branchB1] }));
    expect(moved.restaurantIds).toEqual([w.restaurantB]);
    expect((await ra.useBranch(w.branchB1).get('/api/v1/tables')).status).toBe(200);
    expect((await ra.useBranch(w.branchA1).get('/api/v1/tables')).status).toBe(403);
  });

  it('keeps branches isolated: a Restaurant Admin can be assigned to only one branch', async () => {
    const two = await w.sa.post('/api/v1/admin/users', {
      name: 'Two',
      email: 'two@test.local',
      password: PASSWORD,
      branchIds: [w.branchA1, w.branchA2],
    });
    expect(two.status).toBe(400);
    expect(two.body.error.message).toMatch(/only one branch/);
    const users = ok<{ id: string; email: string }[]>(await w.sa.get('/api/v1/admin/users'));
    const a1 = users.find((u) => u.email === 'a1@test.local')!;
    expect((await w.sa.patch(`/api/v1/admin/users/${a1.id}`, { branchIds: [w.branchA1, w.branchB1] })).status).toBe(400);
    expect((await w.sa.patch(`/api/v1/admin/users/${a1.id}`, { branchIds: [] })).status).toBe(400);
  });

  it('rejects duplicate emails and unknown branches', async () => {
    expect((await w.sa.post('/api/v1/admin/users', { name: 'D', email: 'a1@test.local', password: PASSWORD, branchIds: [w.branchA1] })).status).toBe(409);
    expect(
      (await w.sa.post('/api/v1/admin/users', { name: 'D', email: 'd@test.local', password: PASSWORD, branchIds: ['0123456789abcdef01234567'] })).status,
    ).toBe(400);
  });

  it('enforces the password policy', async () => {
    const res = await w.sa.post('/api/v1/admin/users', { name: 'W', email: 'weak@test.local', password: 'short', branchIds: [w.branchA1] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('writes audit logs for administrative actions', async () => {
    expect(await AuditLogModel.countDocuments({ action: 'RESTAURANT_CREATED' })).toBe(3); // A, B and C
    expect(await AuditLogModel.countDocuments({ action: 'RESTAURANT_ADMIN_REASSIGNED' })).toBe(1);
    const logs = ok<unknown[]>(await w.sa.get('/api/v1/admin/audit-logs?limit=5'));
    expect(logs).toHaveLength(5);
  });
});

describe('Restaurant Admin cannot use Super Admin APIs', () => {
  it.each([
    ['get', '/api/v1/admin/restaurants'],
    ['post', '/api/v1/admin/restaurants'],
    ['post', '/api/v1/admin/branches'],
    ['post', '/api/v1/admin/users'],
    ['get', '/api/v1/admin/users'],
    ['get', '/api/v1/admin/analytics/overview?from=2026-01-01&to=2026-01-31'],
    ['get', '/api/v1/admin/reports/sales.csv?from=2026-01-01&to=2026-01-31'],
    ['get', '/api/v1/admin/audit-logs'],
  ] as const)('%s %s → 403', async (method, url) => {
    const res =
      method === 'get'
        ? await w.adminA1.get(url)
        : await w.adminA1.post(url, { name: 'X', restaurantId: w.restaurantA, code: 'X', email: 'x@x.io', password: PASSWORD, branchIds: [w.branchA1] });
    expect(res.status).toBe(403);
  });
});
