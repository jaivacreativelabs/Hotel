/**
 * Emailed daily sales report for the Super Admin: today's sales across all branches, the
 * Cash / UPI (GPay) / Card split and item-wise sales. Sent once a day at DAILY_REPORT_TIME by the
 * in-process timer (long-running server) or by Vercel Cron (serverless), whichever comes first.
 */
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import type { Types } from 'mongoose';
import { formatMoney, PAYMENT_METHODS, type DailyReportSettingsDTO, type DailyReportSettingsInput, type PaymentMethod } from '@rb/shared';
import { env, serverRoot } from '../config/env.js';
import type { AuthUser } from '../middleware/auth.js';
import { BranchModel, ReportSettingModel, RestaurantModel, TransactionModel, type ReportSetting } from '../models/index.js';
import { dayRange, todayIn } from '../utils/dates.js';
import { AppError } from '../utils/errors.js';
import { audit } from './audit.service.js';
import { longDate, renderDailyReportHtml, renderDailyReportText } from './dailyReport.template.js';

const SETTINGS_ID = 'daily';

export interface DailyReport {
  date: string;
  asOf: Date;
  totalSales: number;
  billCount: number;
  averageBill: number;
  taxTotal: number;
  payments: { method: PaymentMethod; sales: number; bills: number }[];
  items: { name: string; quantity: number; sales: number }[];
  branches: { restaurantName: string; branchName: string; sales: number; bills: number }[];
  voided: { bills: number; amount: number };
  refunded: { bills: number; amount: number };
}

interface Bucket {
  _id: unknown;
  sales: number;
  bills: number;
}

/** Collects the report for `date` (YYYY-MM-DD in APP_TIMEZONE) from completed bills. */
export async function buildDailyReport(date: string, asOf = new Date()): Promise<DailyReport> {
  const { start, end } = dayRange(date, date, env.APP_TIMEZONE);
  const sum = { sales: { $sum: '$grandTotal' }, bills: { $sum: 1 } };
  const [f] = await TransactionModel.aggregate<{
    summary: { sales: number; bills: number; tax: number }[];
    payments: Bucket[];
    items: { _id: Types.ObjectId; name: string; quantity: number; sales: number }[];
    branches: (Bucket & { restaurantId: Types.ObjectId })[];
    excluded: Bucket[];
  }>([
    { $match: { finalizedAt: { $gte: start, $lt: end } } },
    {
      $facet: {
        summary: [{ $match: { status: 'COMPLETED' } }, { $group: { _id: null, ...sum, tax: { $sum: '$taxTotal' } } }],
        payments: [{ $match: { status: 'COMPLETED' } }, { $group: { _id: '$paymentMethod', ...sum } }],
        items: [
          { $match: { status: 'COMPLETED' } },
          { $unwind: '$items' },
          { $group: { _id: '$items.menuItemId', name: { $last: '$items.name' }, quantity: { $sum: '$items.quantity' }, sales: { $sum: '$items.lineTotal' } } },
          { $sort: { sales: -1, quantity: -1, name: 1 } },
        ],
        branches: [{ $match: { status: 'COMPLETED' } }, { $group: { _id: '$branchId', restaurantId: { $first: '$restaurantId' }, ...sum } }, { $sort: { sales: -1 } }],
        excluded: [{ $match: { status: { $ne: 'COMPLETED' } } }, { $group: { _id: '$status', ...sum } }],
      },
    },
  ]);

  const [restaurants, branches] = await Promise.all([
    RestaurantModel.find({ _id: { $in: f.branches.map((b) => b.restaurantId) } }).select('name').lean<{ _id: Types.ObjectId; name: string }[]>(),
    BranchModel.find({ _id: { $in: f.branches.map((b) => b._id) } }).select('name').lean<{ _id: Types.ObjectId; name: string }[]>(),
  ]);
  const rName = new Map(restaurants.map((r) => [String(r._id), r.name]));
  const bName = new Map(branches.map((b) => [String(b._id), b.name]));
  const s = f.summary[0] ?? { sales: 0, bills: 0, tax: 0 };
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
    payments: PAYMENT_METHODS.map((method) => {
      const p = f.payments.find((x) => x._id === method);
      return { method, sales: p?.sales ?? 0, bills: p?.bills ?? 0 };
    }),
    items: f.items.map((i) => ({ name: i.name, quantity: i.quantity, sales: i.sales })),
    branches: f.branches.map((b) => ({
      restaurantName: rName.get(String(b.restaurantId)) ?? 'Unknown',
      branchName: bName.get(String(b._id)) ?? 'Unknown',
      sales: b.sales,
      bills: b.bills,
    })),
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

let transport: nodemailer.Transporter | null = null;
function mailer() {
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transport;
}

export function reportSubject(r: DailyReport): string {
  return `Daily Sales Report – ${longDate(r.date)} – ${formatMoney(r.totalSales)}`;
}

/** HTML for the in-app preview; the logo is inlined there instead of attached. */
export async function previewDailyReport(date = todayIn(env.APP_TIMEZONE)): Promise<string> {
  const logo = fs.existsSync(logoPath) ? `data:image/jpeg;base64,${fs.readFileSync(logoPath).toString('base64')}` : null;
  return renderDailyReportHtml(await buildDailyReport(date), { logoSrc: logo, sendTime: env.DAILY_REPORT_TIME });
}

async function deliver(report: DailyReport, recipients: string[]) {
  const hasLogo = fs.existsSync(logoPath);
  await mailer().sendMail({
    from: { name: env.MAIL_FROM_NAME, address: env.SMTP_USER },
    to: recipients,
    subject: reportSubject(report),
    text: renderDailyReportText(report),
    html: renderDailyReportHtml(report, { logoSrc: hasLogo ? `cid:${LOGO_CID}` : null, sendTime: env.DAILY_REPORT_TIME }),
    attachments: hasLogo ? [{ filename: 'logo.jpg', path: logoPath, cid: LOGO_CID }] : [],
  });
}

export type SendResult = { status: 'sent'; date: string; recipients: string[] } | { status: 'skipped'; reason: string };

/**
 * Sends the report for `date`. Scheduled sends claim the day first so it goes out only once;
 * `manual` sends (the Super Admin's "Send now") always go and do not use up the day.
 */
export async function sendDailyReport(opts: { date?: string; manual?: AuthUser } = {}): Promise<SendResult> {
  const date = opts.date ?? todayIn(env.APP_TIMEZONE);
  if (!env.mailConfigured) {
    if (opts.manual) throw new AppError(503, 'MAIL_NOT_CONFIGURED', 'Email is not set up on the server yet (SMTP_USER / SMTP_PASS).');
    return { status: 'skipped', reason: 'mail not configured' };
  }
  const settings = await loadSettings();
  if (!settings.recipients.length) {
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
    await deliver(await buildDailyReport(date), settings.recipients);
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
      summary: `Sent the daily report for ${date} to ${settings.recipients.join(', ')}`,
    });
  }
  return { status: 'sent', date, recipients: settings.recipients };
}

/** Current HH:MM in APP_TIMEZONE. */
function clockIn(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(now);
}

/**
 * Sends today's report if it is due. The in-process timer checks the clock; Vercel Cron is
 * itself the clock (`ignoreClock`), since on some plans it fires anywhere within the hour.
 */
export async function runDueDailyReport(now = new Date(), ignoreClock = false): Promise<SendResult> {
  if (!ignoreClock && clockIn(env.APP_TIMEZONE, now) < env.DAILY_REPORT_TIME) return { status: 'skipped', reason: 'not yet time' };
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
