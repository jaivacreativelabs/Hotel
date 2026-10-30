import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { ReportSettingModel, TransactionModel } from '../src/models/index.js';
import { buildDailyReport, runDueDailyReport, sendDailyReport } from '../src/services/dailyReport.service.js';
import { todayIn } from '../src/utils/dates.js';
import { buildWorld, type Client, key, ok, useTestDatabase, type World } from './helpers.js';

const sendMail = vi.hoisted(() => vi.fn(async (_mail: unknown) => ({ messageId: 'test' })));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));

useTestDatabase();

let w: World;
const today = () => todayIn(env.APP_TIMEZONE);

async function bill(c: Client, items: { menuItemId: string; quantity: number }[], paymentMethod: string) {
  let d = ok<{ id: string; version: number }>(await c.get('/api/v1/bills/counter'));
  d = ok(await c.put(`/api/v1/bills/${d.id}`, { version: d.version, items }));
  const res = await c.post(`/api/v1/bills/${d.id}/finalize`, { version: d.version, paymentMethod, idempotencyKey: key() });
  return res.body.data.transaction as { id: string };
}

function configureMail(on: boolean) {
  Object.assign(env, { SMTP_USER: on ? 'reports@example.com' : '', SMTP_PASS: on ? 'app-password' : '', mailConfigured: on, CRON_SECRET: on ? 'cron-secret-for-tests' : '' });
}

beforeAll(async () => {
  w = await buildWorld();
  await bill(w.adminA1, [{ menuItemId: w.items.idly, quantity: 2 }, { menuItemId: w.items.coffee, quantity: 1 }], 'CASH'); // 85
  await bill(w.adminA1, [{ menuItemId: w.items.dosa, quantity: 1 }], 'UPI'); // 50
  await bill(w.adminA2, [{ menuItemId: w.items.idly, quantity: 1 }], 'UPI'); // 30
  const voided = await bill(w.adminA1, [{ menuItemId: w.items.biryani, quantity: 1 }], 'CARD'); // 80, voided
  ok(await w.adminA1.post(`/api/v1/transactions/${voided.id}/void`, { reason: 'Wrong bill' }));
});

describe('daily report contents', () => {
  it('totals paid bills, splits by payment and lists items', async () => {
    const r = await buildDailyReport(today());
    expect(r.totalSales).toBe(16500);
    expect(r.billCount).toBe(3);
    expect(r.payments).toEqual([
      { method: 'CASH', sales: 8500, bills: 1 },
      { method: 'UPI', sales: 8000, bills: 2 },
      { method: 'CARD', sales: 0, bills: 0 },
    ]);
    expect(r.voided).toEqual({ bills: 1, amount: 8000 });
  });

  it('breaks the day down branch by branch, listing branches without bills too', async () => {
    const r = await buildDailyReport(today());
    const [a1, a2, ...rest] = r.branches;
    expect([a1.branchName, a1.sales, a1.bills]).toEqual(['Branch A1', 13500, 2]);
    expect(a1.payments).toEqual([
      { method: 'CASH', sales: 8500, bills: 1 },
      { method: 'UPI', sales: 5000, bills: 1 },
      { method: 'CARD', sales: 0, bills: 0 },
    ]);
    expect(a1.items.map((i) => [i.name, i.quantity, i.sales])).toEqual([
      ['Idly', 2, 6000],
      ['Dosa', 1, 5000],
      ['Coffee', 1, 2500],
    ]);
    expect([a2.branchName, a2.sales]).toEqual(['Branch A2', 3000]);
    expect(a2.items).toEqual([{ name: 'Idly', quantity: 1, sales: 3000 }]);
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((b) => b.sales === 0 && b.items.length === 0)).toBe(true);
    expect(rest.map((b) => b.branchName)).toContain('Branch B1');
  });

  it('leaves out generated demo bills', async () => {
    const t = await TransactionModel.findOne({ status: 'COMPLETED', grandTotal: 3000 });
    await TransactionModel.collection.updateOne({ _id: t!._id }, { $set: { isDemo: true } }); // bills are immutable through the model
    const r = await buildDailyReport(today());
    expect([r.totalSales, r.billCount]).toEqual([13500, 2]);
    await TransactionModel.collection.updateOne({ _id: t!._id }, { $set: { isDemo: false } });
  });

  it('renders a preview for the Super Admin only', async () => {
    const html = ok<{ html: string }>(await w.sa.get('/api/v1/admin/daily-report/preview')).html;
    expect(html).toContain('Daily Sales Report');
    expect(html).toContain('GPay / UPI');
    expect(html).toContain('Idly');
    expect((await w.adminA1.get('/api/v1/admin/daily-report/preview')).status).toBe(403);
  });
});

describe('sending', () => {
  it('saves recipients and validates them', async () => {
    expect((await w.sa.put('/api/v1/admin/daily-report', { enabled: true, recipients: ['not-an-email'] })).status).toBe(400);
    const s = ok<{ recipients: string[]; sendTime: string }>(await w.sa.put('/api/v1/admin/daily-report', { enabled: true, recipients: ['Owner@Example.com'] }));
    expect(s.recipients).toEqual(['owner@example.com']);
    expect(s.sendTime).toBe('21:00');
    expect((await w.adminA1.put('/api/v1/admin/daily-report', { enabled: true, recipients: ['x@example.com'] })).status).toBe(403);
  });

  it('explains when mail is not set up', async () => {
    configureMail(false);
    const res = await w.sa.post('/api/v1/admin/daily-report/send');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('MAIL_NOT_CONFIGURED');
    expect(await sendDailyReport()).toEqual({ status: 'skipped', reason: 'mail not configured' });
  });

  it('sends on schedule once per day, and "Send now" any time', async () => {
    configureMail(true);
    sendMail.mockClear();
    expect((await runDueDailyReport(new Date('2026-10-25T10:00:00+05:30'))).status).toBe('skipped'); // before 9 PM
    expect(sendMail).not.toHaveBeenCalled();

    expect((await sendDailyReport({ date: today() })).status).toBe('sent');
    expect(await sendDailyReport({ date: today() })).toEqual({ status: 'skipped', reason: 'already sent' });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0] as { to: string[]; subject: string; html: string; attachments: { cid: string }[] };
    expect(mail.to).toEqual(['owner@example.com']);
    expect(mail.subject).toContain('₹ 165');
    expect(mail.html).toContain('cid:logo@tiffinhouse');
    expect(mail.attachments[0].cid).toBe('logo@tiffinhouse');

    ok(await w.sa.post('/api/v1/admin/daily-report/send'));
    expect(sendMail).toHaveBeenCalledTimes(2);

    // A one-off copy goes only to the given address and does not change the saved list.
    const once = ok<{ recipients: string[] }>(await w.sa.post('/api/v1/admin/daily-report/send', { to: ['Guest@Example.com'] }));
    expect(once.recipients).toEqual(['guest@example.com']);
    expect((sendMail.mock.calls[2][0] as { to: string[] }).to).toEqual(['guest@example.com']);
    expect(ok<{ recipients: string[] }>(await w.sa.get('/api/v1/admin/daily-report')).recipients).toEqual(['owner@example.com']);
    expect((await w.sa.post('/api/v1/admin/daily-report/send', { to: ['nope'] })).status).toBe(400);
    expect((await ReportSettingModel.findById('daily').lean())?.lastSentFor).toBe(today());
  });

  it('gives the day back when sending fails', async () => {
    await ReportSettingModel.updateOne({ _id: 'daily' }, { $set: { lastSentFor: '' } });
    sendMail.mockRejectedValueOnce(new Error('Invalid login'));
    expect((await sendDailyReport({ date: today() })).status).toBe('skipped');
    const s = await ReportSettingModel.findById('daily').lean();
    expect(s?.lastSentFor).toBe('');
    expect(s?.lastError).toContain('Invalid login');
  });

  it('cron endpoint needs the secret', async () => {
    const app = createApp();
    expect((await request(app).get('/api/v1/cron/daily-report')).status).toBe(401);
    expect((await request(app).get('/api/v1/cron/daily-report').set('Authorization', 'Bearer wrong')).status).toBe(401);
    const sendTime = env.DAILY_REPORT_TIME;
    Object.assign(env, { DAILY_REPORT_TIME: '00:00' }); // the endpoint never sends before the report time
    const res = await request(app).get('/api/v1/cron/daily-report').set('Authorization', 'Bearer cron-secret-for-tests');
    Object.assign(env, { DAILY_REPORT_TIME: sendTime });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('sent');
    configureMail(false);
  });

  it('tells the Daily Report page what the last automatic check did', async () => {
    const app = createApp();
    const settings = async () => ok<{ lastRunAt: string | null; lastRunResult: string }>(await w.sa.get('/api/v1/admin/daily-report'));
    expect((await settings()).lastRunResult).toMatch(/^sent to /); // the run above
    // Vercel Cron without CRON_SECRET: refused, and the page says why.
    expect((await request(app).get('/api/v1/cron/daily-report').set('User-Agent', 'vercel-cron/1.0')).status).toBe(401);
    expect((await settings()).lastRunResult).toBe('refused: CRON_SECRET is not set on the server');
    // With the secret but no email set up: skipped, with the reason.
    const sendTime = env.DAILY_REPORT_TIME;
    Object.assign(env, { CRON_SECRET: 'cron-secret-for-tests', DAILY_REPORT_TIME: '00:00' });
    ok(await request(app).get('/api/v1/cron/daily-report').set('Authorization', 'Bearer cron-secret-for-tests'));
    Object.assign(env, { CRON_SECRET: '', DAILY_REPORT_TIME: sendTime });
    expect((await settings()).lastRunResult).toBe('mail not configured');
  });
});
