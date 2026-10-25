import type { PaymentMethod, TransactionStatus } from '@rb/shared';

export { formatMoney } from '@rb/shared';

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

export const formatDate = (iso: string) => dateFmt.format(new Date(iso));
export const formatTime = (iso: string) => timeFmt.format(new Date(iso)).toUpperCase();
export const formatDateTime = (iso: string) => `${formatDate(iso)}, ${formatTime(iso)}`;

/** Local calendar date as YYYY-MM-DD. */
export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function shiftDays(d: Date, days: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + days);
  return c;
}

export type DatePreset = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom';

export function presetRange(preset: DatePreset, now = new Date()): { from?: string; to?: string } {
  const today = isoDay(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = isoDay(shiftDays(now, -1));
      return { from: y, to: y };
    }
    case 'week': {
      const monday = shiftDays(now, -((now.getDay() + 6) % 7));
      return { from: isoDay(monday), to: today };
    }
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    default:
      return {};
  }
}

export const formatDay = (day: string) => dateFmt.format(new Date(`${day}T00:00:00`));

/** getRandomValues also works on plain-HTTP LAN deployments, unlike randomUUID. */
export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `bill_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export const PAYMENT_LABEL: Record<PaymentMethod, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card' };
export const STATUS_LABEL: Record<TransactionStatus, string> = { COMPLETED: 'Paid', VOIDED: 'Voided', REFUNDED: 'Refunded' };

/** Joins class names, skipping falsy values. */
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
