import { beforeAll, describe, expect, it } from 'vitest';
import { UserModel } from '../src/models/index.js';
import { buildWorld, ok, PASSWORD, useTestDatabase, type World } from './helpers.js';

useTestDatabase();

let w: World;
let foreignDraft: { id: string; version: number };
beforeAll(async () => {
  w = await buildWorld();
  foreignDraft = ok(await w.adminA1.post('/api/v1/bills/table-groups', { tableId: w.tables.t1, guestCount: 2 }), 201);
});

describe('branch isolation', () => {
  it('rejects a branch header the admin is not assigned to', async () => {
    const res = await w.adminA2.get('/api/v1/tables').set('X-Branch-Id', w.branchA1);
    expect(res.status).toBe(403);
    const unknown = await w.adminA2.get('/api/v1/tables').set('X-Branch-Id', '0123456789abcdef01234567');
    expect(unknown.status).toBe(403);
  });

  it('cannot read or modify another branch’s drafts by id', async () => {
    expect((await w.adminA2.get(`/api/v1/bills/${foreignDraft.id}`)).status).toBe(404);
    expect((await w.adminA2.put(`/api/v1/bills/${foreignDraft.id}`, { version: foreignDraft.version, items: [] })).status).toBe(404);
    expect((await w.adminA2.post(`/api/v1/bills/${foreignDraft.id}/finalize`, { version: 0, paymentMethod: 'CASH', idempotencyKey: 'abcdefgh1' })).status).toBe(404);
    expect((await w.adminA2.delete(`/api/v1/bills/${foreignDraft.id}?version=${foreignDraft.version}`)).status).toBe(404);
    expect((await w.adminB1.get(`/api/v1/bills?tableId=${w.tables.t1}`)).status).toBe(404);
  });

  it('cannot use another branch’s tables', async () => {
    expect((await w.adminA2.post('/api/v1/bills/table-groups', { tableId: w.tables.t2, guestCount: 1 })).status).toBe(404);
    expect((await w.adminA2.patch(`/api/v1/tables/${w.tables.t2}`, { seats: 10 })).status).toBe(404);
    expect((await w.adminA2.delete(`/api/v1/tables/${w.tables.t2}`)).status).toBe(404);
  });

  it('cannot bill items from another restaurant’s menu', async () => {
    const d = ok<{ id: string; version: number }>(await w.adminB1.get('/api/v1/bills/counter'));
    const res = await w.adminB1.put(`/api/v1/bills/${d.id}`, { version: d.version, items: [{ menuItemId: w.items.idly, quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ITEM_NOT_FOUND');
  });

  it('cannot edit another restaurant’s menu items or categories', async () => {
    expect((await w.adminB1.patch(`/api/v1/menu/items/${w.items.idly}`, { price: 1 })).status).toBe(404);
    expect((await w.adminB1.post(`/api/v1/menu/items/${w.items.idly}/archive`)).status).toBe(404);
    expect((await w.adminB1.post('/api/v1/menu/items', { categoryId: w.categoryId, name: 'Sneaky', price: 1 })).status).toBe(404);
  });

  it('Restaurant Admins cannot manage the shared menu by passing restaurantId', async () => {
    const res = await w.adminA1.post(`/api/v1/menu/items?restaurantId=${w.restaurantA}`, { categoryId: w.categoryId, name: 'X', price: 1 }).set('X-Branch-Id', '');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BRANCH_REQUIRED');
  });

  it('Restaurant Admins cannot create Super Admins, restaurants or branches', async () => {
    expect((await w.adminA1.post('/api/v1/admin/users', { name: 'Evil', email: 'evil@test.local', password: PASSWORD, branchIds: [w.branchA1] })).status).toBe(403);
    expect((await w.adminA1.post('/api/v1/admin/restaurants', { name: 'Evil Co' })).status).toBe(403);
    expect((await w.adminA1.post('/api/v1/admin/branches', { restaurantId: w.restaurantA, name: 'Evil', code: 'EV' })).status).toBe(403);
    expect(await UserModel.countDocuments({ role: 'SUPER_ADMIN' })).toBe(1);
  });

  it('rejects malformed ids and bodies cleanly without leaking internals', async () => {
    const bad = await w.adminA1.get('/api/v1/bills/not-an-id');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_ID');
    const badJson = await w.adminA1.agent
      .post('/api/v1/tables')
      .set('X-Requested-With', 'rb-client')
      .set('X-Branch-Id', w.branchA1)
      .set('Content-Type', 'application/json')
      .send('{"label":');
    expect(badJson.status).toBe(400);
    expect(JSON.stringify(badJson.body)).not.toMatch(/stack|at .*\.ts/);
  });

  it('sets security headers', async () => {
    const res = await w.adminA1.get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
