import { bpsToPercent, type PaymentMethod, type TaxLine, type TransactionStatus } from '@rb/shared';

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

/** "GST (5%)" – a tax line on a bill. */
export function taxLabel(t: TaxLine, included: boolean): string {
  return `${t.name} (${bpsToPercent(t.rateBps)}%)${included ? ' incl.' : ''}`;
}

interface TaxedItem {
  name: string;
  taxable: boolean;
  taxRateBps: number | null;
  extraTaxes: { name: string; rateBps: number }[];
}

/** "GST 5% · Service charge 10%": an item's own taxes ("" when it has none). */
export function itemTaxText(i: Pick<TaxedItem, 'taxRateBps' | 'extraTaxes'>): string {
  return [
    ...(Number(i.taxRateBps) > 0 ? [`GST ${bpsToPercent(i.taxRateBps!)}%`] : []),
    ...(i.extraTaxes ?? []).map((t) => `${t.name} ${bpsToPercent(t.rateBps)}%`),
  ].join(' · ');
}

/** Which items of a bill a tax line was charged on, e.g. "Idly (Half, 1), Dosa". */
export function taxedItemsText(t: TaxLine, items: TaxedItem[]): string {
  const own = (i: TaxedItem) => i.taxRateBps !== null && i.taxRateBps !== undefined;
  let hit = items.filter((i) => (i.extraTaxes ?? []).some((x) => x.name === t.name && x.rateBps === t.rateBps));
  if (!hit.length && t.name === 'GST') hit = items.filter((i) => i.taxRateBps === t.rateBps);
  // Bills made before GST was one line split an item's own GST into CGST + SGST halves.
  if (!hit.length && (t.name === 'CGST' || t.name === 'SGST')) hit = items.filter((i) => own(i) && Math.abs(i.taxRateBps! - 2 * t.rateBps) <= 1);
  if (!hit.length) hit = items.filter((i) => !own(i) && i.taxable); // the restaurant's taxes
  const names = hit.map((i) => i.name);
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} + ${names.length - 3} more` : names.join(', ');
}

/** Joins class names, skipping falsy values. */
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
