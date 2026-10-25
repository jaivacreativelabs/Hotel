import { beforeAll, describe, expect, it } from 'vitest';
import type { AnalyticsOverviewDTO } from '@rb/shared';
import { buildWorld, type Client, key, ok, useTestDatabase, type World } from './helpers.js';

useTestDatabase();

let w: World;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

async function bill(c: Client, menuItemId: string, quantity: number, paymentMethod: string) {
  let d = ok<{ id: string; version: number }>(await c.get('/api/v1/bills/counter'));
  d = ok(await c.put(`/api/v1/bills/${d.id}`, { version: d.version, items: [{ menuItemId, quantity }] }));
  return (await c.post(`/api/v1/bills/${d.id}/finalize`, { version: d.version, paymentMethod, idempotencyKey: key() })).body.data
    .transaction as { id: string };
}

beforeAll(async () => {
  w = await buildWorld();
  // Restaurant B needs its own menu for its branch.
  const cat = ok<{ id: string }>(await w.adminB1.post('/api/v1/menu/categories', { name: 'Food' }), 201);
  const itemB = ok<{ id: string }>(await w.adminB1.post('/api/v1/menu/items', { categoryId: cat.id, name: 'Meals', price: 12000 }), 201);

  await bill(w.adminA1, w.items.idly, 2, 'CASH'); // 6000
  await bill(w.adminA1, w.items.dosa, 1, 'UPI'); // 5000
  await bill(w.adminA2, w.items.biryani, 1, 'CARD'); // 8000
  await bill(w.adminB1, itemB.id, 1, 'UPI'); // 12000
  const voided = await bill(w.adminA1, w.items.coffee, 4, 'CASH'); // 10000 → voided
  ok(await w.adminA1.post(`/api/v1/transactions/${voided.id}/void`, { reason: 'Test void' }));
  // An open draft must never count as revenue.
  const open = ok<{ id: string; version: number }>(await w.adminA2.get('/api/v1/bills/counter'));
  ok(await w.adminA2.put(`/api/v1/bills/${open.id}`, { version: open.version, items: [{ menuItemId: w.items.idly, quantity: 9 }] }));
});

describe('Super Admin analytics', () => {
  it('aggregates completed bills only', async () => {
    const o = ok<AnalyticsOverviewDTO>(await w.sa.get(`/api/v1/admin/analytics/overview?from=${today}&to=${today}`));
    expect(o.summary).toEqual({ totalSales: 31000, billCount: 4, averageBill: 7750, taxTotal: 0 });
    expect(o.excluded).toMatchObject({ voidedCount: 1, voidedAmount: 10000 });
    expect(o.daily).toEqual([{ key: today, sales: 31000, bills: 4 }]);
    expect(o.byRestaurant.map((r) => [r.name, r.sales])).toEqual([
      ['Restaurant A', 19000],
      ['Restaurant B', 12000],
    ]);
    expect(o.byBranch.find((b) => b.name === 'Branch A1')?.sales).toBe(11000);
    expect(Object.fromEntries(o.byPaymentMethod.map((p) => [p.key, p.sales]))).toEqual({ UPI: 17000, CARD: 8000, CASH: 6000 });
  });

  it('filters by restaurant and branch', async () => {
    const a = ok<AnalyticsOverviewDTO>(await w.sa.get(`/api/v1/admin/analytics/overview?from=${today}&to=${today}&restaurantId=${w.restaurantA}`));
    expect(a.summary.totalSales).toBe(19000);
    const a2 = ok<AnalyticsOverviewDTO>(await w.sa.get(`/api/v1/admin/analytics/overview?from=${today}&to=${today}&branchId=${w.branchA2}`));
    expect(a2.summary).toMatchObject({ totalSales: 8000, billCount: 1 });
  });

  it('fills empty days and months in the range', async () => {
    const o = ok<AnalyticsOverviewDTO>(await w.sa.get('/api/v1/admin/analytics/overview?from=2020-01-30&to=2020-03-02'));
    expect(o.daily).toHaveLength(33);
    expect(o.monthly.map((m) => m.key)).toEqual(['2020-01', '2020-02', '2020-03']);
    expect(o.summary.billCount).toBe(0);
  });

  it('validates the range', async () => {
    expect((await w.sa.get('/api/v1/admin/analytics/overview?from=2026-02-01&to=2026-01-01')).status).toBe(400);
    expect((await w.sa.get('/api/v1/admin/analytics/overview')).status).toBe(400);
  });

  it('exports CSV reports with filters applied', async () => {
    const daily = await w.sa.get(`/api/v1/admin/reports/sales.csv?from=${today}&to=${today}`);
    expect(daily.text).toContain(`${today},4,310.00,77.50`);
    const branches = await w.sa.get(`/api/v1/admin/reports/branches.csv?from=${today}&to=${today}&restaurantId=${w.restaurantA}`);
    expect(branches.text).toContain('Restaurant A,Branch A1,2,110.00');
    expect(branches.text).not.toContain('Restaurant B');
    const restaurants = await w.sa.get(`/api/v1/admin/reports/restaurants.csv?from=${today}&to=${today}`);
    expect(restaurants.text).toContain('Restaurant B,1,120.00');
    const txCsv = await w.sa.get(`/api/v1/admin/reports/transactions.csv?status=VOIDED`);
    expect(txCsv.text.trim().split('\r\n')).toHaveLength(2);
  });

  it('is unavailable to Restaurant Admins', async () => {
    expect((await w.adminA1.get(`/api/v1/admin/analytics/overview?from=${today}&to=${today}`)).status).toBe(403);
    expect((await w.adminA1.get(`/api/v1/admin/reports/branches.csv?from=${today}&to=${today}`)).status).toBe(403);
  });
});
