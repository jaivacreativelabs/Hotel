import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { ReportSettingModel } from '../src/models/index.js';
import { buildWorld, type Client, key, ok, useTestDatabase, type World } from './helpers.js';

const sendMail = vi.hoisted(() => vi.fn(async (_mail: unknown) => ({ messageId: 'test' })));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));

useTestDatabase();

let w: World;
type Mail = { subject: string; html: string };
const mails = () => sendMail.mock.calls.map((c) => c[0] as Mail);

async function bill(c: Client, menuItemId: string) {
  let d = ok<{ id: string; version: number }>(await c.get('/api/v1/bills/counter'));
  d = ok(await c.put(`/api/v1/bills/${d.id}`, { version: d.version, items: [{ menuItemId, quantity: 1 }] }));
  ok(await c.post(`/api/v1/bills/${d.id}/finalize`, { version: d.version, paymentMethod: 'CASH', idempotencyKey: key() }), 201);
}

beforeAll(async () => {
  w = await buildWorld();
  Object.assign(env, { SMTP_USER: 'reports@example.com', SMTP_PASS: 'app-password', mailConfigured: true, CRON_SECRET: 'cron-secret-for-tests' });
  await ReportSettingModel.create({ _id: 'daily', enabled: true, recipients: ['owner@example.com'] });
  await bill(w.adminA1, w.items.idly);
  await bill(w.adminA2, w.items.dosa);
});
beforeEach(() => sendMail.mockClear());

describe('Close Shop', () => {
  it('refuses while a table still has an open bill', async () => {
    const g = ok<{ id: string; version: number }>(await w.adminA1.post('/api/v1/bills/table-groups', { tableId: w.tables.t1, guestCount: 2 }), 201);
    const res = await w.adminA1.post('/api/v1/shop/close');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OPEN_BILLS');
    expect(res.body.error.message).toContain('T1');
    ok(await w.adminA1.delete(`/api/v1/bills/${g.id}?version=${g.version}`), 204);
  });

  it('closes the shop, emails that restaurant’s own report and locks billing', async () => {
    const closed = ok<{ shopOpen: boolean; report: { sent: boolean; message: string } }>(await w.adminA1.post('/api/v1/shop/close'));
    expect(closed).toMatchObject({ shopOpen: false, report: { sent: true } });
    expect(mails()).toHaveLength(1);
    expect(mails()[0].subject).toMatch(/Daily Sales Report/);
    expect(mails()[0].html).toContain('Idly'); // A1's own sale only, not A2's Dosa
    expect(mails()[0].html).not.toContain('Dosa');
    // The app knows, and billing is locked; looking at bills still works.
    const me = ok<{ branches: { id: string; shopOpen: boolean }[] }>(await w.adminA1.get('/api/v1/auth/me'));
    expect(me.branches.find((b) => b.id === w.branchA1)?.shopOpen).toBe(false);
    const counter = ok<{ id: string; version: number }>(await w.adminA1.get('/api/v1/bills/counter'));
    const res = await w.adminA1.put(`/api/v1/bills/${counter.id}`, { version: counter.version, items: [{ menuItemId: w.items.idly, quantity: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SHOP_CLOSED');
    expect((await w.adminA1.post('/api/v1/bills/manual-sale', { amount: 5000, paymentMethod: 'CASH', idempotencyKey: key() })).status).toBe(409);
    // Another restaurant keeps billing.
    expect((await w.adminA2.get('/api/v1/bills/counter')).status).toBe(200);
    // A second tap does not email again.
    expect(ok<{ shopOpen: boolean }>(await w.adminA1.post('/api/v1/shop/close'))).toEqual({ shopOpen: false });
    expect(mails()).toHaveLength(1); // still just the first one
  });

  it('the evening email skips a restaurant that closed and sends the others their own', async () => {
    const sendTime = env.DAILY_REPORT_TIME;
    Object.assign(env, { DAILY_REPORT_TIME: '00:00' });
    const run = await request(createApp()).get('/api/v1/cron/daily-report').set('Authorization', 'Bearer cron-secret-for-tests');
    expect(run.body.data.status).toBe('sent');
    expect(mails()).toHaveLength(1); // A2 only (A1 closed and sent; B1 had nothing today)
    expect(mails()[0].html).toContain('Dosa');
    // Run again: nothing new.
    const again = await request(createApp()).get('/api/v1/cron/daily-report').set('Authorization', 'Bearer cron-secret-for-tests');
    Object.assign(env, { DAILY_REPORT_TIME: sendTime });
    expect(again.body.data).toEqual({ status: 'skipped', reason: 'already sent' });
    expect(mails()).toHaveLength(1);
  });

  it('Open Shop unlocks billing', async () => {
    expect(ok<{ shopOpen: boolean }>(await w.adminA1.post('/api/v1/shop/open'))).toEqual({ shopOpen: true });
    await bill(w.adminA1, w.items.vada);
  });

  it('only restaurant admins (and the Super Admin) open or close a shop', async () => {
    expect((await w.adminA2.post('/api/v1/shop/close', undefined).set('X-Branch-Id', w.branchA1)).status).toBe(403);
  });
});
