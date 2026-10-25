import { beforeAll, describe, expect, it } from 'vitest';
import { AuditLogModel, TransactionModel } from '../src/models/index.js';
import { buildWorld, type Client, key, ok, useTestDatabase, type World } from './helpers.js';

useTestDatabase();

let w: World;
const bills: { id: string; billNumber: string; grandTotal: number }[] = [];

async function bill(c: Client, items: { menuItemId: string; quantity: number }[], paymentMethod = 'CASH') {
  let d = ok<{ id: string; version: number }>(await c.get('/api/v1/bills/counter'));
  d = ok(await c.put(`/api/v1/bills/${d.id}`, { version: d.version, items }));
  const res = await c.post(`/api/v1/bills/${d.id}/finalize`, { version: d.version, paymentMethod, idempotencyKey: key() });
  return res.body.data.transaction as { id: string; billNumber: string; grandTotal: number };
}

beforeAll(async () => {
  w = await buildWorld();
  for (let i = 0; i < 25; i++) {
    bills.push(await bill(w.adminA1, [{ menuItemId: w.items.idly, quantity: (i % 3) + 1 }], i % 2 ? 'UPI' : 'CASH'));
  }
  bills.push(await bill(w.adminA2, [{ menuItemId: w.items.dosa, quantity: 1 }], 'CARD'));
});

describe('transaction history', () => {
  it('paginates on the server, newest first', async () => {
    const p1 = await w.adminA1.get('/api/v1/transactions?limit=10&page=1');
    expect(p1.body.meta).toEqual({ page: 1, limit: 10, total: 25, totalPages: 3 });
    expect(p1.body.data).toHaveLength(10);
    expect(p1.body.data[0].billNumber).toBe('B00025');
    const p3 = await w.adminA1.get('/api/v1/transactions?limit=10&page=3');
    expect(p3.body.data).toHaveLength(5);
  });

  it('searches by bill number', async () => {
    const res = await w.adminA1.get('/api/v1/transactions?q=%23B00007');
    expect(res.body.data.map((t: { billNumber: string }) => t.billNumber)).toEqual(['B00007']);
  });

  it('filters by payment method and date', async () => {
    const upi = await w.adminA1.get('/api/v1/transactions?paymentMethod=UPI&limit=100');
    expect(upi.body.meta.total).toBe(12);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const inRange = await w.adminA1.get(`/api/v1/transactions?from=${today}&to=${today}`);
    expect(inRange.body.meta.total).toBe(25);
    const past = await w.adminA1.get('/api/v1/transactions?from=2020-01-01&to=2020-01-31');
    expect(past.body.meta.total).toBe(0);
    expect((await w.adminA1.get('/api/v1/transactions?from=yesterday')).status).toBe(400);
  });

  it('keeps branches isolated', async () => {
    const a2 = await w.adminA2.get('/api/v1/transactions');
    expect(a2.body.meta.total).toBe(1);
    expect((await w.adminA2.get(`/api/v1/transactions?branchId=${w.branchA1}`)).status).toBe(403);
    expect((await w.adminA2.get(`/api/v1/transactions/${bills[0].id}`)).status).toBe(404);
    expect((await w.adminB1.get('/api/v1/transactions')).body.meta.total).toBe(0);
    // Super Admin sees everything and can filter by branch.
    expect((await w.sa.get('/api/v1/transactions')).body.meta.total).toBe(26);
    expect((await w.sa.get(`/api/v1/transactions?branchId=${w.branchA2}`)).body.meta.total).toBe(1);
  });

  it('exports CSV scoped to the caller and the filters', async () => {
    const res = await w.adminA1.get('/api/v1/transactions/export.csv?paymentMethod=CASH');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const rows = res.text.trim().split('\r\n');
    expect(rows).toHaveLength(1 + 13);
    expect(res.text).not.toContain('Branch A2');
  });
});

describe('void / refund workflow', () => {
  it('voids with a reason, logs it, and refuses a second change', async () => {
    const target = bills[0];
    expect((await w.adminA1.post(`/api/v1/transactions/${target.id}/void`, {})).status).toBe(400);
    const voided = ok<{ status: string; statusChange: { reason: string }; grandTotal: number }>(
      await w.adminA1.post(`/api/v1/transactions/${target.id}/void`, { reason: 'Wrong table' }),
    );
    expect(voided.status).toBe('VOIDED');
    expect(voided.grandTotal).toBe(target.grandTotal);
    expect(voided.statusChange.reason).toBe('Wrong table');
    expect((await w.adminA1.post(`/api/v1/transactions/${target.id}/refund`, { reason: 'again' })).status).toBe(409);
    expect(await AuditLogModel.countDocuments({ action: 'TRANSACTION_VOIDED', entityId: target.id })).toBe(1);
  });

  it('refunds and marks the payment refunded', async () => {
    const r = ok<{ status: string; paymentStatus: string }>(
      await w.adminA1.post(`/api/v1/transactions/${bills[1].id}/refund`, { reason: 'Customer complaint' }),
    );
    expect(r).toMatchObject({ status: 'REFUNDED', paymentStatus: 'REFUNDED' });
  });

  it('other branches cannot void', async () => {
    expect((await w.adminA2.post(`/api/v1/transactions/${bills[2].id}/void`, { reason: 'not mine' })).status).toBe(404);
    expect((await TransactionModel.findById(bills[2].id).lean())?.status).toBe('COMPLETED');
  });
});
