import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { ExpenseModel } from '../src/models/index.js';
import { buildDailyReport } from '../src/services/dailyReport.service.js';
import { addDays, todayIn } from '../src/utils/dates.js';
import { buildWorld, key, ok, useTestDatabase, type World } from './helpers.js';

useTestDatabase();

interface Expense {
  id: string;
  branchId: string;
  branchName: string;
  date: string;
  category: string;
  amount: number;
  note: string;
  editableUntil: string | null;
}
interface ExpenseList {
  expenses: Expense[];
  meta: { total: number };
  totalAmount: number;
  byCategory: { category: string; amount: number; count: number }[];
}

let w: World;
const today = () => todayIn(env.APP_TIMEZONE);
const gas = () => ({ date: today(), category: 'GAS', amount: 120000, paymentMethod: 'CASH', note: 'Cylinder' });

beforeAll(async () => {
  w = await buildWorld();
});

describe('recording expenses', () => {
  let mine: Expense;

  it('adds an expense to the admin’s own branch', async () => {
    mine = ok<Expense>(await w.adminA1.post('/api/v1/expenses', gas()), 201);
    expect([mine.branchId, mine.category, mine.amount, mine.note]).toEqual([w.branchA1, 'GAS', 120000, 'Cylinder']);
    expect(mine.editableUntil).not.toBeNull();
    ok(await w.adminA1.post('/api/v1/expenses', { date: today(), category: 'VEGETABLES', amount: 45000, paymentMethod: 'UPI' }), 201);
  });

  it('rejects future dates, zero amounts and unknown fields', async () => {
    expect((await w.adminA1.post('/api/v1/expenses', { ...gas(), date: addDays(today(), 1) })).status).toBe(400);
    expect((await w.adminA1.post('/api/v1/expenses', { ...gas(), amount: 0 })).status).toBe(400);
    expect((await w.adminA1.post('/api/v1/expenses', { ...gas(), branchId: w.branchB1 })).status).toBe(400);
  });

  it('lists only the branch’s expenses, with totals by category', async () => {
    ok(await w.adminB1.post('/api/v1/expenses', { ...gas(), amount: 99900 }), 201);
    const list = ok<ExpenseList>(await w.adminA1.get('/api/v1/expenses'));
    expect(list.meta.total).toBe(2);
    expect(list.totalAmount).toBe(165000);
    expect(list.byCategory).toEqual([
      { category: 'GAS', amount: 120000, count: 1 },
      { category: 'VEGETABLES', amount: 45000, count: 1 },
    ]);
    expect(ok<ExpenseList>(await w.adminA1.get('/api/v1/expenses?category=GAS')).meta.total).toBe(1);
    expect((await w.adminA1.get(`/api/v1/expenses?branchId=${w.branchB1}`)).status).toBe(403);

    const all = ok<ExpenseList>(await w.sa.get('/api/v1/expenses'));
    expect(all.meta.total).toBe(3);
    expect(ok<ExpenseList>(await w.sa.get(`/api/v1/expenses?branchId=${w.branchB1}`)).totalAmount).toBe(99900);
  });

  it('lets only the branch change it, and only within the edit window', async () => {
    expect((await w.adminB1.put(`/api/v1/expenses/${mine.id}`, gas())).status).toBe(404);
    expect((await w.adminB1.delete(`/api/v1/expenses/${mine.id}`)).status).toBe(404);

    const edited = ok<Expense>(await w.adminA1.put(`/api/v1/expenses/${mine.id}`, { ...gas(), amount: 110000 }));
    expect(edited.amount).toBe(110000);

    // createdAt is immutable through Mongoose, so age the expense directly in the collection.
    await ExpenseModel.collection.updateOne({ _id: new Types.ObjectId(mine.id) }, { $set: { createdAt: new Date(Date.now() - 31 * 60_000) } });
    expect((await w.adminA1.put(`/api/v1/expenses/${mine.id}`, gas())).status).toBe(403);
    expect((await w.adminA1.delete(`/api/v1/expenses/${mine.id}`)).status).toBe(403);
    // The Super Admin can still correct it.
    expect(ok<Expense>(await w.sa.put(`/api/v1/expenses/${mine.id}`, { ...gas(), amount: 100000 })).amount).toBe(100000);
  });

  it('deletes an expense so it no longer counts', async () => {
    const extra = ok<Expense>(await w.adminA1.post('/api/v1/expenses', { ...gas(), category: 'OTHER', amount: 500 }), 201);
    expect((await w.adminA1.delete(`/api/v1/expenses/${extra.id}`)).status).toBe(204);
    expect((await w.adminA1.delete(`/api/v1/expenses/${extra.id}`)).status).toBe(404);
    expect(ok<ExpenseList>(await w.adminA1.get('/api/v1/expenses')).totalAmount).toBe(145000);
  });
});

describe('daily report', () => {
  it('shows each branch’s expenses and the net', async () => {
    let d = ok<{ id: string; version: number }>(await w.adminA1.get('/api/v1/bills/counter'));
    d = ok(await w.adminA1.put(`/api/v1/bills/${d.id}`, { version: d.version, items: [{ menuItemId: w.items.dosa, quantity: 40 }] }));
    ok(await w.adminA1.post(`/api/v1/bills/${d.id}/finalize`, { version: d.version, paymentMethod: 'CASH', idempotencyKey: key() }), 201);

    const r = await buildDailyReport(today());
    expect(r.totalExpenses).toBe(244900);
    expect(r.net).toBe(r.totalSales - 244900);
    const a1 = r.branches.find((b) => b.expenses === 145000)!;
    expect(a1.expenseLines.map((e) => [e.category, e.amount])).toEqual([
      ['GAS', 100000],
      ['VEGETABLES', 45000],
    ]);
    // A branch with expenses but no bills is still listed.
    expect(r.branches.some((b) => b.bills === 0 && b.expenses === 99900)).toBe(true);
  });
});
