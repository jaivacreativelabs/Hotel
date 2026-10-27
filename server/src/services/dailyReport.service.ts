/**
 * Emailed daily sales report for the Super Admin: today's sales across all branches, the
 * Cash / UPI (GPay) / Card split, item-wise sales, and the day's expenses with sale minus expenses. Sent once a day at DAILY_REPORT_TIME by the
 * in-process timer (long-running server) or by Vercel Cron (serverless), whichever comes first.
 */
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import type { Types } from 'mongoose';
import {
  formatMoney,
  PAYMENT_METHODS,
  type DailyReportSettingsDTO,
  type DailyReportSettingsInput,
  type ExpenseCategory,
  type PaymentMethod,
} from '@rb/shared';
import { env, serverRoot } from '../config/env.js';
import type { AuthUser } from '../middleware/auth.js';
import { BranchModel, ExpenseModel, ReportSettingModel, RestaurantModel, TransactionModel, type ReportSetting } from '../models/index.js';
import { dayRange, todayIn } from '../utils/dates.js';
import { AppError } from '../utils/errors.js';
import { audit } from './audit.service.js';
import { longDate, renderDailyReportHtml, renderDailyReportText } from './dailyReport.template.js';

const SETTINGS_ID = 'daily';

export interface PaymentTotal {
  method: PaymentMethod;
  sales: number;
  bills: number;
}
export interface ItemTotal {
  name: string;
  quantity: number;
  sales: number;
}
export interface ExpenseLine {
  category: ExpenseCategory;
  amount: number;
  note: string;
  paymentMethod: PaymentMethod;
}
export interface BranchReport {
  restaurantName: string;
  branchName: string;
  sales: number;
  bills: number;
  payments: PaymentTotal[];
  items: ItemTotal[];
  /** Total spent today and each expense, largest first */
  expenses: number;
  expenseLines: ExpenseLine[];
}

export interface DailyReport {
  date: string;
  asOf: Date;
  totalSales: number;
  billCount: number;
  averageBill: number;
  taxTotal: number;
  /** Expenses recorded for the day across all branches, and sale minus expenses */
  totalExpenses: number;
  net: number;
  payments: PaymentTotal[];
  /** Every active branch (also those without bills today), highest sale first. */
  branches: BranchReport[];
  voided: { bills: number; amount: number };
  refunded: { bills: number; amount: number };
}

interface Bucket {
  _id: unknown;
  sales: number;
  bills: number;
}

const byMethod = (rows: { method: string; sales: number; bills: number }[]): PaymentTotal[] =>
  PAYMENT_METHODS.map((method) => {
    const p = rows.find((x) => x.method === method);
    return { method, sales: p?.sales ?? 0, bills: p?.bills ?? 0 };
  });

/** Collects the report for `date` (YYYY-MM-DD in APP_TIMEZONE) from completed bills. */
export async function buildDailyReport(date: string, asOf = new Date()): Promise<DailyReport> {
  const { start, end } = dayRange(date, date, env.APP_TIMEZONE);
  const sum = { sales: { $sum: '$grandTotal' }, bills: { $sum: 1 } };
  const paid = { $match: { status: 'COMPLETED' } };
  const [f] = await TransactionModel.aggregate<{
    summary: { sales: number; bills: number; tax: number }[];
    payments: { _id: { b: Types.ObjectId; m: string }; sales: number; bills: number }[];
    items: { _id: { b: Types.ObjectId }; name: string; quantity: number; sales: number }[];
    branches: (Bucket & { _id: Types.ObjectId })[];
    excluded: Bucket[];
  }>([
    // Real bills only: generated demo bills (isDemo) never reach the report.
    { $match: { finalizedAt: { $gte: start, $lt: end }, isDemo: { $ne: true } } },
    {
      $facet: {
        summary: [paid, { $group: { _id: null, ...sum, tax: { $sum: '$taxTotal' } } }],
        payments: [paid, { $group: { _id: { b: '$branchId', m: '$paymentMethod' }, ...sum } }],
        items: [
          paid,
          { $unwind: '$items' },
          {
            $group: {
              _id: { b: '$branchId', i: '$items.menuItemId' },
              name: { $last: '$items.name' },
              quantity: { $sum: '$items.quantity' },
              sales: { $sum: '$items.lineTotal' },
            },
          },
          { $sort: { sales: -1, quantity: -1, name: 1 } },
        ],
        branches: [paid, { $group: { _id: '$branchId', ...sum } }],
        excluded: [{ $match: { status: { $ne: 'COMPLETED' } } }, { $group: { _id: '$status', ...sum } }],
      },
    },
  ]);

  const expenses = await ExpenseModel.find({ date, status: 'ACTIVE' })
    .sort({ amount: -1 })
    .select('branchId category amount note paymentMethod')
    .lean<(ExpenseLine & { branchId: Types.ObjectId })[]>();

  // Active branches of active restaurants are always listed, so a branch with no bills stands out.
  const activeRestaurants = await RestaurantModel.find({ status: 'ACTIVE' }).select('_id').lean<{ _id: Types.ObjectId }[]>();
  const branchDocs = await BranchModel.find({
    $or: [
      { _id: { $in: [...f.branches.map((b) => b._id), ...expenses.map((e) => e.branchId)] } },
      { status: 'ACTIVE', restaurantId: { $in: activeRestaurants.map((r) => r._id) } },
    ],
  })
    .select('name restaurantId')
    .lean<{ _id: Types.ObjectId; name: string; restaurantId: Types.ObjectId }[]>();
  const restaurants = await RestaurantModel.find({ _id: { $in: branchDocs.map((b) => b.restaurantId) } })
    .select('name')
    .lean<{ _id: Types.ObjectId; name: string }[]>();
  const rName = new Map(restaurants.map((r) => [String(r._id), r.name]));

  const branchReports = branchDocs.map((b): BranchReport => {
    const key = String(b._id);
    const total = f.branches.find((x) => String(x._id) === key);
    const expenseLines = expenses
      .filter((e) => String(e.branchId) === key)
      .map((e) => ({ category: e.category, amount: e.amount, note: e.note ?? '', paymentMethod: e.paymentMethod }));
    return {
      restaurantName: rName.get(String(b.restaurantId)) ?? 'Unknown',
      branchName: b.name,
      sales: total?.sales ?? 0,
      bills: total?.bills ?? 0,
      payments: byMethod(f.payments.filter((p) => String(p._id.b) === key).map((p) => ({ method: p._id.m, sales: p.sales, bills: p.bills }))),
      items: f.items.filter((i) => String(i._id.b) === key).map((i) => ({ name: i.name, quantity: i.quantity, sales: i.sales })),
      expenses: expenseLines.reduce((a, e) => a + e.amount, 0),
      expenseLines,
    };
  });
  branchReports.sort((a, b) => b.sales - a.sales || a.restaurantName.localeCompare(b.restaurantName) || a.branchName.localeCompare(b.branchName));

  const totals = new Map<string, { sales: number; bills: number }>();
  for (const p of f.payments) {
    const t = totals.get(p._id.m) ?? { sales: 0, bills: 0 };
    totals.set(p._id.m, { sales: t.sales + p.sales, bills: t.bills + p.bills });
  }
  const s = f.summary[0] ?? { sales: 0, bills: 0, tax: 0 };
  const totalExpenses = expenses.reduce((a, e) => a + e.amount, 0);
  const excluded = (status: string) => {
    const e = f.excluded.find((x) => x._id === status);
    return { bills: e?.bills ?? 0, amount: e?.sales ?? 0 };
  };

  return {
    date,
    asOf,
    totalSales: s.sales,
    billCount: s.bills,
    averageBill: s.bills ? Math.round(s.sales / s.bills) : 0,
    taxTotal: s.tax,
    totalExpenses,
    net: s.sales - totalExpenses,
    payments: byMethod([...totals].map(([method, t]) => ({ method, ...t }))),
    branches: branchReports,
    voided: excluded('VOIDED'),
    refunded: excluded('REFUNDED'),
  };
}

// ---------------- Settings ----------------

async function loadSettings(): Promise<ReportSetting & { _id: string }> {
  return (await ReportSettingModel.findOneAndUpdate(
    { _id: SETTINGS_ID },
    { $setOnInsert: { enabled: true, recipients: [] } },
    { upsert: true, new: true },
  ).lean<ReportSetting & { _id: string }>())!;
}

function toDTO(s: ReportSetting): DailyReportSettingsDTO {
  return {
    enabled: s.enabled,
    recipients: s.recipients,
    sendTime: env.DAILY_REPORT_TIME,
    timezone: env.APP_TIMEZONE,
    mailConfigured: env.mailConfigured,
    sender: env.SMTP_USER,
    lastSentFor: s.lastSentFor,
    lastSentAt: s.lastSentAt ? new Date(s.lastSentAt).toISOString() : null,
    lastError: s.lastError,
  };
}

export async function getDailyReportSettings(): Promise<DailyReportSettingsDTO> {
  return toDTO(await loadSettings());
}

export async function updateDailyReportSettings(user: AuthUser, input: DailyReportSettingsInput): Promise<DailyReportSettingsDTO> {
  await loadSettings();
  const updated = await ReportSettingModel.findByIdAndUpdate(SETTINGS_ID, { $set: input }, { new: true }).lean<ReportSetting>();
  await audit(user, {
    action: 'DAILY_REPORT_SETTINGS_UPDATED',
    entityType: 'ReportSetting',
    entityId: SETTINGS_ID,
    summary: `Daily report ${input.enabled ? 'on' : 'off'} · ${input.recipients.join(', ') || 'no recipients'}`,
  });
  return toDTO(updated!);
}

// ---------------- Sending ----------------

const LOGO_CID = 'logo@tiffinhouse';
const logoPath = path.join(serverRoot, 'assets', 'report-logo.jpg');

/**
 * Connects over IPv4: nodemailer sometimes picks Gmail's IPv6 address, which Vercel's functions
 * cannot reach ("connect ETIMEDOUT 2404:…"). TLS still checks the real host name.
 */
async function mailer() {
  const ipv4 = await dns.lookup(env.SMTP_HOST, { family: 4 }).then(
    (r) => r.address,
    () => env.SMTP_HOST, // lookup failed: let nodemailer try the name itself
  );
  return nodemailer.createTransport({
    host: ipv4,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    tls: { servername: env.SMTP_HOST },
  });
}

export function reportSubject(r: DailyReport): string {
  return `Daily Sales Report – ${longDate(r.date)} – ${formatMoney(r.totalSales)}`;
}

/** HTML for the in-app preview; the logo is inlined there instead of attached. */
export async function previewDailyReport(date = todayIn(env.APP_TIMEZONE)): Promise<string> {
  const logo = fs.existsSync(logoPath) ? `data:image/jpeg;base64,${fs.readFileSync(logoPath).toString('base64')}` : null;
  return renderDailyReportHtml(await buildDailyReport(date), { logoSrc: logo });
}

async function deliver(report: DailyReport, recipients: string[]) {
  const hasLogo = fs.existsSync(logoPath);
  await (await mailer()).sendMail({
    from: { name: env.MAIL_FROM_NAME, address: env.SMTP_USER },
    to: recipients,
    subject: reportSubject(report),
    text: renderDailyReportText(report),
    html: renderDailyReportHtml(report, { logoSrc: hasLogo ? `cid:${LOGO_CID}` : null }),
    attachments: hasLogo ? [{ filename: 'logo.jpg', path: logoPath, cid: LOGO_CID }] : [],
  });
}

export type SendResult = { status: 'sent'; date: string; recipients: string[] } | { status: 'skipped'; reason: string };

/**
 * Sends the report for `date`. Scheduled sends claim the day first so it goes out only once;
 * `manual` sends (the Super Admin's "Send now") always go and do not use up the day; they may go
 * to a one-off `to` list instead of the saved recipients.
 */
export async function sendDailyReport(opts: { date?: string; manual?: AuthUser; to?: string[] } = {}): Promise<SendResult> {
  const date = opts.date ?? todayIn(env.APP_TIMEZONE);
  if (!env.mailConfigured) {
    if (opts.manual) throw new AppError(503, 'MAIL_NOT_CONFIGURED', 'Email is not set up on the server yet (SMTP_USER / SMTP_PASS).');
    return { status: 'skipped', reason: 'mail not configured' };
  }
  const settings = await loadSettings();
  const recipients = opts.manual && opts.to?.length ? opts.to : settings.recipients;
  if (!recipients.length) {
    if (opts.manual) throw new AppError(400, 'NO_RECIPIENTS', 'Add at least one email address first.');
    return { status: 'skipped', reason: 'no recipients' };
  }

  let previous: string | null = null;
  if (!opts.manual) {
    const before = await ReportSettingModel.findOneAndUpdate(
      { _id: SETTINGS_ID, enabled: true, lastSentFor: { $ne: date } },
      { $set: { lastSentFor: date } },
    ).lean<ReportSetting>();
    if (!before) return { status: 'skipped', reason: settings.enabled ? 'already sent' : 'turned off' };
    previous = before.lastSentFor;
  }

  try {
    await deliver(await buildDailyReport(date), recipients);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ReportSettingModel.updateOne(
      { _id: SETTINGS_ID },
      { $set: { lastError: message.slice(0, 300), ...(previous !== null && { lastSentFor: previous }) } },
    );
    console.error('[daily-report] send failed:', message);
    if (opts.manual) throw new AppError(502, 'MAIL_FAILED', `Could not send the email: ${message}`);
    return { status: 'skipped', reason: `send failed: ${message}` };
  }

  await ReportSettingModel.updateOne({ _id: SETTINGS_ID }, { $set: { lastSentAt: new Date(), lastError: '' } });
  if (opts.manual) {
    await audit(opts.manual, {
      action: 'DAILY_REPORT_SENT',
      entityType: 'ReportSetting',
      entityId: SETTINGS_ID,
      summary: `Sent the daily report for ${date} to ${recipients.join(', ')}`,
    });
  }
  return { status: 'sent', date, recipients };
}

/** Current HH:MM in APP_TIMEZONE. */
function clockIn(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(now);
}

/**
 * Sends today's report if it is due – never before DAILY_REPORT_TIME, whoever calls (the
 * in-process timer, an external scheduler, or Vercel Cron, which on Hobby fires anywhere in its hour).
 */
export async function runDueDailyReport(now = new Date()): Promise<SendResult> {
  if (clockIn(env.APP_TIMEZONE, now) < env.DAILY_REPORT_TIME) return { status: 'skipped', reason: 'not yet time' };
  return sendDailyReport({ date: todayIn(env.APP_TIMEZONE, now) });
}

/** Long-running servers: check once a minute. Not used on Vercel (no process stays alive). */
export function startDailyReportTimer(): NodeJS.Timeout {
  const tick = () => void runDueDailyReport().catch((err) => console.error('[daily-report]', err));
  const timer = setInterval(tick, 60_000);
  timer.unref();
  tick();
  return timer;
}
