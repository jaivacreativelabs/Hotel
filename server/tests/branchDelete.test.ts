import { beforeAll, describe, expect, it } from 'vitest';
import { BranchModel, TableModel, TransactionModel, UserModel } from '../src/models/index.js';
import { buildWorld, key, ok, useTestDatabase, type World } from './helpers.js';

useTestDatabase();

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});

describe('deleting a location', () => {
  it('only the Super Admin can, and it removes the location with its bills and its own logins', async () => {
    let d = ok<{ id: string; version: number }>(await w.adminA2.get('/api/v1/bills/counter'));
    d = ok(await w.adminA2.put(`/api/v1/bills/${d.id}`, { version: d.version, items: [{ menuItemId: w.items.idly, quantity: 1 }] }));
    ok(await w.adminA2.post(`/api/v1/bills/${d.id}/finalize`, { version: d.version, paymentMethod: 'CASH', idempotencyKey: key() }), 201);
    expect(await TransactionModel.countDocuments({ branchId: w.branchA2 })).toBe(1);

    expect((await w.adminA1.delete(`/api/v1/admin/branches/${w.branchA2}`)).status).toBe(403);
    ok(await w.sa.delete(`/api/v1/admin/branches/${w.branchA2}`));

    expect(await BranchModel.exists({ _id: w.branchA2 })).toBeNull();
    expect(await TransactionModel.countDocuments({ branchId: w.branchA2 })).toBe(0);
    expect(await TableModel.countDocuments({ branchId: w.branchA2 })).toBe(0);
    expect(await UserModel.countDocuments({ branchIds: w.branchA2 })).toBe(0);
    // The other location is untouched.
    expect(await BranchModel.exists({ _id: w.branchA1 })).not.toBeNull();
    expect((await w.adminA1.get('/api/v1/tables')).status).toBe(200);
  });

  it('refuses the last location of a restaurant', async () => {
    const r = ok<{ id: string; mainBranchId: string }>(await w.sa.post('/api/v1/admin/restaurants', { name: 'Solo Cafe' }), 201);
    const res = await w.sa.delete(`/api/v1/admin/branches/${r.mainBranchId}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_LOCATION');
  });
});
