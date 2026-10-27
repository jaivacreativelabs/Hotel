/**
 * Daily report email. Table layout with inline styles so it renders the same in Gmail, Outlook
 * and phone mail apps. Colours follow the app theme (client/src/styles/theme.css).
 */
import { EXPENSE_CATEGORY_LABEL, formatMoney, type PaymentMethod } from '@rb/shared';
import { env } from '../config/env.js';
import type { BranchReport, DailyReport, ItemTotal, PaymentTotal } from './dailyReport.service.js';

/** "2026-10-25" → "Sun, 25 Oct 2026" */
export function longDate(date: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${date}T00:00:00Z`));
}

const C = {
  primary: '#1e7b34',
  primarySoft: '#e7f3ea',
  secondary: '#f7c600',
  text: '#1a1d1a',
  muted: '#667065',
  subtle: '#8c948a',
  border: '#e3e7e0',
  page: '#f2f4ef',
  surfaceMuted: '#f7f8f4',
  danger: '#d43c3c',
  dangerSoft: '#fdf3f3',
};
const FONT = `-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;

export const PAYMENT_NAME: Record<PaymentMethod, string> = { CASH: 'Cash', UPI: 'GPay / UPI', CARD: 'Card' };
const PAYMENT_COLOUR: Record<PaymentMethod, string> = { CASH: C.primary, UPI: C.secondary, CARD: '#2f6fdb' };

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

function timeOf(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: env.APP_TIMEZONE, hour: 'numeric', minute: '2-digit', hour12: true }).format(d).toUpperCase();
}

function sectionTitle(title: string, aside = ''): string {
  return `<tr><td style="padding:28px 24px 10px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font:600 15px/20px ${FONT};color:${C.text};">${title}</td>
      <td align="right" style="font:400 13px/20px ${FONT};color:${C.muted};">${aside}</td>
    </tr></table>
  </td></tr>`;
}

function stat(label: string, value: string, align: 'left' | 'center' | 'right'): string {
  return `<td align="${align}" width="33%" style="padding:0 4px;">
    <div style="font:400 12px/16px ${FONT};color:${C.muted};">${label}</div>
    <div style="font:600 16px/22px ${FONT};color:${C.text};padding-top:2px;">${value}</div>
  </td>`;
}

function paymentBar(payments: PaymentTotal[], total: number): string {
  const paid = payments.filter((p) => p.sales > 0);
  if (!paid.length) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-radius:5px;overflow:hidden;"><tr>${paid
    .map((p) => `<td width="${Math.max(pct(p.sales, total), 1)}%" style="height:10px;line-height:10px;font-size:0;background:${PAYMENT_COLOUR[p.method]};">&nbsp;</td>`)
    .join('')}</tr></table>`;
}

function paymentSection(r: DailyReport): string {
  const rows = r.payments
    .map(
      (p, i) => `<tr>
        <td style="padding:12px 0;${i ? `border-top:1px solid ${C.border};` : ''}font:400 14px/20px ${FONT};color:${C.text};white-space:nowrap;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:${PAYMENT_COLOUR[p.method]};margin-right:10px;vertical-align:middle;"></span>${PAYMENT_NAME[p.method]}
        </td>
        <td align="right" style="padding:12px 0;${i ? `border-top:1px solid ${C.border};` : ''}font:400 13px/20px ${FONT};color:${C.muted};white-space:nowrap;">
          ${pct(p.sales, r.totalSales)}%
        </td>
        <td align="right" width="110" style="padding:12px 0;${i ? `border-top:1px solid ${C.border};` : ''}font:600 14px/20px ${FONT};color:${C.text};white-space:nowrap;">${formatMoney(p.sales)}</td>
      </tr>`,
    )
    .join('');
  return `${sectionTitle(r.branches.length > 1 ? 'Payment split – all branches' : 'Payment split')}
  <tr><td style="padding:0 24px;">
    ${paymentBar(r.payments, r.totalSales)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">${rows}</table>
  </td></tr>`;
}

/** One line per branch: what each branch made today. */
function branchSummary(r: DailyReport): string {
  const rows = r.branches
    .map(
      (b, i) => `<tr>
        <td style="padding:10px 0;${i ? `border-top:1px solid ${C.border};` : ''}font:500 14px/20px ${FONT};color:${C.text};">${esc(b.branchName)}
          <div style="font:400 12px/16px ${FONT};color:${C.muted};">${esc(b.restaurantName)}</div></td>
        <td align="right" style="padding:10px 0;${i ? `border-top:1px solid ${C.border};` : ''}font:400 13px/20px ${FONT};color:${C.muted};white-space:nowrap;">${
          b.bills ? `${b.bills} bill${b.bills === 1 ? '' : 's'}` : 'No bills'
        }${b.expenses ? `<div style="font:400 12px/16px ${FONT};color:${C.danger};">Spent ${formatMoney(b.expenses)}</div>` : ''}</td>
        <td align="right" width="110" style="padding:10px 0;${i ? `border-top:1px solid ${C.border};` : ''}font:600 14px/20px ${FONT};color:${b.bills ? C.text : C.subtle};white-space:nowrap;">${formatMoney(b.sales)}</td>
      </tr>`,
    )
    .join('');
  return `${sectionTitle('Branch-wise sale', `${r.branches.length} branch${r.branches.length === 1 ? '' : 'es'}`)}
  <tr><td style="padding:0 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>`;
}

function branchPayments(b: BranchReport): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;"><tr>${b.payments
    .map(
      (p, i) => `<td width="33%" align="${i === 0 ? 'left' : i === 2 ? 'right' : 'center'}" style="padding:4px 0;">
        <div style="font:400 12px/16px ${FONT};color:${C.muted};white-space:nowrap;"><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${PAYMENT_COLOUR[p.method]};margin-right:6px;"></span>${PAYMENT_NAME[p.method]}</div>
        <div style="font:600 15px/22px ${FONT};color:${C.text};white-space:nowrap;">${formatMoney(p.sales)}</div>
      </td>`,
    )
    .join('')}</tr></table>`;
}

function itemTable(items: ItemTotal[]): string {
  const qty = items.reduce((a, i) => a + i.quantity, 0);
  const cell = (i: number) => `padding:9px 12px;${i ? `border-top:1px solid ${C.border};` : ''}`;
  const rows = items
    .map(
      (it, i) => `<tr>
        <td style="${cell(i)}font:400 14px/20px ${FONT};color:${C.text};">${esc(it.name)}</td>
        <td align="center" width="56" style="${cell(i)}font:400 14px/20px ${FONT};color:${C.muted};">${it.quantity}</td>
        <td align="right" width="100" style="${cell(i)}font:500 14px/20px ${FONT};color:${C.text};white-space:nowrap;">${formatMoney(it.sales)}</td>
      </tr>`,
    )
    .join('');
  const head = (label: string, align: string) =>
    `<td align="${align}" style="padding:8px 12px;font:600 12px/16px ${FONT};color:${C.muted};border-bottom:1px solid ${C.border};">${label}</td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border:1px solid ${C.border};border-radius:8px;border-collapse:separate;">
      <tr style="background:${C.surfaceMuted};">${head('Item', 'left')}${head('Qty', 'center')}${head('Amount', 'right')}</tr>
      ${rows}
      <tr style="background:${C.primarySoft};">
        <td style="padding:9px 12px;border-top:1px solid ${C.border};font:600 14px/20px ${FONT};color:${C.text};">Total</td>
        <td align="center" style="padding:9px 12px;border-top:1px solid ${C.border};font:600 14px/20px ${FONT};color:${C.text};">${qty}</td>
        <td align="right" style="padding:9px 12px;border-top:1px solid ${C.border};font:600 14px/20px ${FONT};color:${C.primary};white-space:nowrap;">${formatMoney(items.reduce((a, i) => a + i.sales, 0))}</td>
      </tr>
    </table>`;
}

function expenseTable(b: BranchReport): string {
  if (!b.expenseLines.length) return '';
  const cell = (i: number) => `padding:9px 12px;${i ? `border-top:1px solid ${C.border};` : ''}`;
  const rows = b.expenseLines
    .map(
      (e, i) => `<tr>
        <td style="${cell(i)}font:400 14px/20px ${FONT};color:${C.text};">${EXPENSE_CATEGORY_LABEL[e.category]}${
          e.note ? `<div style="font:400 12px/16px ${FONT};color:${C.muted};">${esc(e.note)}</div>` : ''
        }</td>
        <td align="center" width="90" style="${cell(i)}font:400 13px/20px ${FONT};color:${C.muted};white-space:nowrap;">${PAYMENT_NAME[e.paymentMethod]}</td>
        <td align="right" width="100" style="${cell(i)}font:500 14px/20px ${FONT};color:${C.text};white-space:nowrap;">${formatMoney(e.amount)}</td>
      </tr>`,
    )
    .join('');
  const head = (label: string, align: string) =>
    `<td align="${align}" style="padding:8px 12px;font:600 12px/16px ${FONT};color:${C.muted};border-bottom:1px solid ${C.border};">${label}</td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border:1px solid ${C.border};border-radius:8px;border-collapse:separate;">
      <tr style="background:${C.surfaceMuted};">${head('Expense', 'left')}${head('Paid by', 'center')}${head('Amount', 'right')}</tr>
      ${rows}
      <tr style="background:${C.dangerSoft};">
        <td colspan="2" style="padding:9px 12px;border-top:1px solid ${C.border};font:600 14px/20px ${FONT};color:${C.text};">Total expenses · Net ${formatMoney(b.sales - b.expenses)}</td>
        <td align="right" style="padding:9px 12px;border-top:1px solid ${C.border};font:600 14px/20px ${FONT};color:${C.danger};white-space:nowrap;">${formatMoney(b.expenses)}</td>
      </tr>
    </table>`;
}

/** Full detail of one branch: its total, payment split, item-wise sale and expenses. */
function branchDetail(b: BranchReport): string {
  return `<tr><td style="padding:24px 24px 0 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.primarySoft};border-radius:8px;"><tr>
      <td style="padding:12px 14px;">
        <div style="font:700 15px/20px ${FONT};color:${C.text};">${esc(b.branchName)}</div>
        <div style="font:400 12px/16px ${FONT};color:${C.muted};">${esc(b.restaurantName)}</div>
      </td>
      <td align="right" style="padding:12px 14px;">
        <div style="font:700 18px/24px ${FONT};color:${C.primary};white-space:nowrap;">${formatMoney(b.sales)}</div>
        <div style="font:400 12px/16px ${FONT};color:${C.muted};white-space:nowrap;">${b.bills} bill${b.bills === 1 ? '' : 's'}</div>
      </td>
    </tr></table>
    ${b.bills ? branchPayments(b) + itemTable(b.items) : ''}
    ${expenseTable(b)}
  </td></tr>`;
}

export function renderDailyReportHtml(r: DailyReport, opts: { logoSrc: string | null }): string {
  const logo = opts.logoSrc
    ? `<img src="${opts.logoSrc}" width="48" height="48" alt="Tiffin House" style="display:block;border-radius:24px;border:1px solid ${C.border};">`
    : `<div style="width:48px;height:48px;border-radius:24px;background:${C.secondary};font:700 20px/48px ${FONT};color:${C.text};text-align:center;">T</div>`;
  const empty = r.billCount === 0;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><title>Daily Sales Report</title></head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;">Total sale ${formatMoney(r.totalSales)} from ${r.billCount} bill${r.billCount === 1 ? '' : 's'} on ${longDate(r.date)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${C.border};border-radius:12px;border-collapse:separate;">

  <tr><td style="padding:24px 24px 20px 24px;border-bottom:1px solid ${C.border};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="60" valign="middle">${logo}</td>
      <td valign="middle">
        <div style="font:700 17px/22px ${FONT};color:${C.text};">Tiffin House</div>
        <div style="font:400 13px/18px ${FONT};color:${C.muted};">Daily Sales Report</div>
      </td>
      <td align="right" valign="middle" style="padding-left:12px;">
        <div style="font:600 14px/20px ${FONT};color:${C.text};white-space:nowrap;">${longDate(r.date)}</div>
        <div style="font:400 12px/18px ${FONT};color:${C.muted};white-space:nowrap;">Till ${timeOf(r.asOf)}</div>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:26px 24px 4px 24px;">
    <div style="font:500 13px/18px ${FONT};color:${C.muted};">Total Sale</div>
    <div style="font:700 34px/42px ${FONT};color:${C.primary};padding-top:2px;">${formatMoney(r.totalSales)}</div>
  </td></tr>
  <tr><td style="padding:14px 20px 4px 20px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.surfaceMuted};border-radius:8px;"><tr><td style="padding:12px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        ${stat('Bills', String(r.billCount), 'left')}
        ${stat('Average bill', formatMoney(r.averageBill), 'center')}
        ${stat('Tax collected', formatMoney(r.taxTotal), 'right')}
      </tr></table>
    </td></tr></table>
  </td></tr>
  <tr><td style="padding:8px 20px 4px 20px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:8px;border-collapse:separate;"><tr>
      <td width="50%" style="padding:12px 14px;">
        <div style="font:400 12px/16px ${FONT};color:${C.muted};">Expenses</div>
        <div style="font:600 16px/22px ${FONT};color:${r.totalExpenses ? C.danger : C.text};padding-top:2px;">${formatMoney(r.totalExpenses)}</div>
      </td>
      <td width="50%" align="right" style="padding:12px 14px;border-left:1px solid ${C.border};">
        <div style="font:400 12px/16px ${FONT};color:${C.muted};">Net (sale − expenses)</div>
        <div style="font:700 16px/22px ${FONT};color:${r.net < 0 ? C.danger : C.primary};padding-top:2px;">${formatMoney(r.net)}</div>
      </td>
    </tr></table>
  </td></tr>

  ${
    empty
      ? `<tr><td style="padding:28px 24px 4px 24px;font:400 14px/20px ${FONT};color:${C.muted};">No bills were made today.</td></tr>`
      : paymentSection(r)
  }
  ${r.branches.length ? branchSummary(r) : ''}
  ${r.branches.filter((b) => b.bills > 0 || b.expenses > 0).map(branchDetail).join('')}

  <tr><td style="height:26px;line-height:26px;font-size:0;">&nbsp;</td></tr>

</table>
</td></tr></table>
</body></html>`;
}

export function renderDailyReportText(r: DailyReport): string {
  const line = (label: string, value: string) => `${label.padEnd(22)}${value}`;
  const out = [
    `Tiffin House – Daily Sales Report`,
    `${longDate(r.date)} (till ${timeOf(r.asOf)})`,
    '',
    line('Total Sale', formatMoney(r.totalSales)),
    line('Bills', String(r.billCount)),
    line('Average bill', formatMoney(r.averageBill)),
    line('Tax collected', formatMoney(r.taxTotal)),
    line('Expenses', formatMoney(r.totalExpenses)),
    line('Net (sale - expenses)', formatMoney(r.net)),
    '',
    'Payment split',
    ...r.payments.map((p) => line(`  ${PAYMENT_NAME[p.method]}`, formatMoney(p.sales))),
    '',
    'Branch-wise sale',
    ...r.branches.map((b) => line(`  ${b.branchName} (${b.restaurantName})`, `${formatMoney(b.sales)}  (${b.bills} bills)`)),
  ];
  for (const b of r.branches.filter((x) => x.bills > 0 || x.expenses > 0)) {
    out.push(
      '',
      `${b.branchName} – ${formatMoney(b.sales)} (${b.bills} bills)`,
      ...b.payments.map((p) => line(`  ${PAYMENT_NAME[p.method]}`, formatMoney(p.sales))),
      ...b.items.map((i) => line(`  ${i.name} x${i.quantity}`, formatMoney(i.sales))),
    );
    if (b.expenses) {
      out.push(
        `  Expenses – ${formatMoney(b.expenses)} (net ${formatMoney(b.sales - b.expenses)})`,
        ...b.expenseLines.map((e) => line(`    ${EXPENSE_CATEGORY_LABEL[e.category]}${e.note ? ` (${e.note})` : ''}`, formatMoney(e.amount))),
      );
    }
  }
  return out.join('\n');
}
