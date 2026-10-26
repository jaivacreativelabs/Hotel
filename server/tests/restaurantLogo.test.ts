import { beforeAll, describe, expect, it } from 'vitest';
import { buildWorld, key, ok, useTestDatabase, type Client, type World } from './helpers.js';

useTestDatabase();

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

let w: World;
const upload = (c: Client, restaurantId: string) =>
  c.agent
    .post(`/api/v1/admin/restaurants/${restaurantId}/logo`)
    .set('X-Requested-With', 'rb-client')
    .attach('image', PNG, { filename: 'logo.png', contentType: 'image/png' });

beforeAll(async () => {
  w = await buildWorld();
});

describe('restaurant logo', () => {
  it('is set by the Super Admin, shown to the branches and printed on new bills', async () => {
    expect((await upload(w.adminA1, w.restaurantA)).status).toBe(403);
    const res = await upload(w.sa, w.restaurantA);
    expect(res.status).toBe(200);
    const logoUrl = res.body.data.logoUrl as string;
    expect(logoUrl).toMatch(/^\/uploads\/menu\/[0-9a-f-]+\.png$/);

    const me = ok<{ branches: { restaurant: { logoUrl: string | null } }[] }>(await w.adminA1.get('/api/v1/auth/me'));
    expect(me.branches[0].restaurant.logoUrl).toBe(logoUrl);
    const other = ok<{ branches: { restaurant: { logoUrl: string | null } }[] }>(await w.adminB1.get('/api/v1/auth/me'));
    expect(other.branches[0].restaurant.logoUrl).toBeNull();

    let d = ok<{ id: string; version: number }>(await w.adminA1.get('/api/v1/bills/counter'));
    d = ok(await w.adminA1.put(`/api/v1/bills/${d.id}`, { version: d.version, items: [{ menuItemId: w.items.idly, quantity: 1 }] }));
    const bill = await w.adminA1.post(`/api/v1/bills/${d.id}/finalize`, { version: d.version, paymentMethod: 'CASH', idempotencyKey: key() });
    expect(bill.body.data.transaction.restaurantSnapshot.logoUrl).toBe(logoUrl);

    const removed = ok<{ logoUrl: string | null }>(await w.sa.delete(`/api/v1/admin/restaurants/${w.restaurantA}/logo`));
    expect(removed.logoUrl).toBeNull();
    // The bill keeps the logo it was printed with.
    const tx = ok<{ restaurantSnapshot: { logoUrl: string } }>(await w.adminA1.get(`/api/v1/transactions/${bill.body.data.transaction.id}`));
    expect(tx.restaurantSnapshot.logoUrl).toBe(logoUrl);
  });
});
