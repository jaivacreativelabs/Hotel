/**
 * Decimal-safe bill arithmetic. All amounts are integer paise, all rates are basis points
 * (1 bps = 0.01 %). The server uses this as the authoritative calculation; the client uses
 * the same code for its instant preview.
 */
import type { DiscountType } from './constants.js';

export interface BillLineInput {
  unitPrice: number;
  quantity: number;
  taxable: boolean;
  /** The item's own GST rate. Unset (null) → the restaurant's taxes apply when `taxable`. */
  taxRateBps?: number | null;
}

export interface TaxRate {
  name: string;
  rateBps: number;
}

export interface DiscountInput {
  type: DiscountType;
  /** PERCENT: basis points (1000 = 10 %). FLAT: paise. */
  value: number;
}

export interface TaxSettings {
  taxes: TaxRate[];
  pricesIncludeTax: boolean;
}

export interface TaxLine extends TaxRate {
  amount: number;
}

export interface BillTotals {
  lineTotals: number[];
  subtotal: number;
  discountAmount: number;
  taxes: TaxLine[];
  taxTotal: number;
  grandTotal: number;
}

function assertSafeInt(n: number, label: string): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${label} must be a safe integer, got ${n}`);
}

/** round(numerator / denominator) with halves rounded up; both operands non-negative integers. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  assertSafeInt(numerator, 'numerator');
  assertSafeInt(denominator, 'denominator');
  if (denominator <= 0) throw new RangeError('denominator must be positive');
  if (numerator < 0) throw new RangeError('numerator must be non-negative');
  const q = Math.floor(numerator / denominator);
  const r = numerator - q * denominator;
  return r * 2 >= denominator ? q + 1 : q;
}

/** An item's own GST rate as it appears on Indian bills: half CGST, half SGST. */
export function gstComponents(rateBps: number): TaxRate[] {
  const sgst = Math.floor(rateBps / 2);
  return [
    { name: 'CGST', rateBps: rateBps - sgst },
    { name: 'SGST', rateBps: sgst },
  ];
}

/** Tax on one group of lines that share the same rates; `base` is after discount. */
function taxFor(base: number, rates: TaxRate[], pricesIncludeTax: boolean): TaxLine[] {
  if (base <= 0) return rates.map((t) => ({ ...t, amount: 0 }));
  if (!pricesIncludeTax) return rates.map((t) => ({ ...t, amount: divRoundHalfUp(base * t.rateBps, 10_000) }));
  const totalBps = rates.reduce((a, t) => a + t.rateBps, 0);
  const net = divRoundHalfUp(base * 10_000, 10_000 + totalBps);
  const taxTotal = base - net;
  let allocated = 0;
  return rates.map((t, i) => {
    const amount = i === rates.length - 1 ? taxTotal - allocated : divRoundHalfUp(net * t.rateBps, 10_000);
    allocated += amount;
    return { ...t, amount };
  });
}

export function calculateBill(
  lines: BillLineInput[],
  settings: TaxSettings,
  discount?: DiscountInput | null,
): BillTotals {
  const lineTotals = lines.map((l) => {
    assertSafeInt(l.unitPrice, 'unitPrice');
    assertSafeInt(l.quantity, 'quantity');
    if (l.unitPrice < 0 || l.quantity < 0) throw new RangeError('negative line');
    return l.unitPrice * l.quantity;
  });
  const subtotal = lineTotals.reduce((a, b) => a + b, 0);

  let discountAmount = 0;
  if (discount && subtotal > 0) {
    if (discount.type === 'PERCENT') {
      const bps = Math.min(Math.max(discount.value, 0), 10_000);
      discountAmount = divRoundHalfUp(subtotal * bps, 10_000);
    } else {
      discountAmount = Math.min(Math.max(discount.value, 0), subtotal);
    }
  }
  const afterDiscount = subtotal - discountAmount;

  // Lines are grouped by the rates they pay: the restaurant's taxes, or the item's own GST %.
  const restaurantRates = settings.taxes.filter((t) => t.rateBps > 0);
  const groups = new Map<string, { rates: TaxRate[]; subtotal: number }>([['restaurant', { rates: restaurantRates, subtotal: 0 }]]);
  lines.forEach((l, i) => {
    const own = l.taxRateBps;
    if (own === null || own === undefined) {
      if (l.taxable) groups.get('restaurant')!.subtotal += lineTotals[i];
      return;
    }
    if (own <= 0) return;
    const key = `own:${own}`;
    if (!groups.has(key)) groups.set(key, { rates: gstComponents(own).filter((t) => t.rateBps > 0), subtotal: 0 });
    groups.get(key)!.subtotal += lineTotals[i];
  });

  // The discount is spread proportionally over every group (and the untaxed lines); same
  // names and rates from different groups (e.g. CGST 2.5 %) are added together.
  const merged = new Map<string, TaxLine>();
  const ordered = [...groups.entries()].sort(([a], [b]) =>
    a === 'restaurant' ? -1 : b === 'restaurant' ? 1 : Number(a.slice(4)) - Number(b.slice(4)),
  );
  for (const [key, g] of ordered) {
    if (key !== 'restaurant' && g.subtotal === 0) continue;
    const base = subtotal > 0 ? g.subtotal - divRoundHalfUp(discountAmount * g.subtotal, subtotal) : 0;
    for (const t of taxFor(base, g.rates, settings.pricesIncludeTax)) {
      const k = `${t.name}|${t.rateBps}`;
      const prev = merged.get(k);
      merged.set(k, prev ? { ...prev, amount: prev.amount + t.amount } : t);
    }
  }
  const taxes = [...merged.values()];
  const taxTotal = taxes.reduce((a, t) => a + t.amount, 0);
  const grandTotal = settings.pricesIncludeTax ? afterDiscount : afterDiscount + taxTotal;

  return { lineTotals, subtotal, discountAmount, taxes, taxTotal, grandTotal };
}

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 3000 → "₹ 30", 3050 → "₹ 30.50" */
export function formatMoney(paise: number, symbol = '₹'): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const text = abs % 100 === 0 ? inr.format(abs / 100) : inr2.format(abs / 100);
  return `${sign}${symbol} ${text}`;
}

/** "30" → 3000, "30.5" → 3050, invalid → null. Avoids floating point entirely. */
export function parseRupeesToPaise(input: string): number | null {
  const s = input.trim();
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const rupees = Number(m[1]);
  const fraction = (m[2] ?? '').padEnd(2, '0');
  return rupees * 100 + Number(fraction);
}

/** 3050 → "30.50", 3000 → "30" (for input fields) */
export function paiseToRupeesInput(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const fraction = paise % 100;
  return fraction === 0 ? String(rupees) : `${rupees}.${String(fraction).padStart(2, '0')}`;
}

/** 250 → "2.5", 205 → "2.05", 1800 → "18" */
export function bpsToPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** "2.5" → 250 (same two-decimal rules as rupees) */
export const parsePercentToBps = parseRupeesToPaise;
