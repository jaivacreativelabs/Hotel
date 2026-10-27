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
  /** Any other taxes on this item (e.g. Service charge 10 %), on top of its GST. */
  extraTaxes?: TaxRate[];
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
  /** What the tax was charged on (after discount); bills made before this was kept have none. */
  base?: number;
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
  if (base <= 0) return rates.map((t) => ({ ...t, amount: 0, base: 0 }));
  if (!pricesIncludeTax) return rates.map((t) => ({ ...t, amount: divRoundHalfUp(base * t.rateBps, 10_000), base }));
  const totalBps = rates.reduce((a, t) => a + t.rateBps, 0);
  const net = divRoundHalfUp(base * 10_000, 10_000 + totalBps);
  const taxTotal = base - net;
  let allocated = 0;
  return rates.map((t, i) => {
    const amount = i === rates.length - 1 ? taxTotal - allocated : divRoundHalfUp(net * t.rateBps, 10_000);
    allocated += amount;
    return { ...t, amount, base };
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

  // Lines are grouped by the rates they pay: the restaurant's taxes or the item's own GST %,
  // plus any other taxes of the item.
  const restaurantRates = settings.taxes.filter((t) => t.rateBps > 0);
  const keyOf = (rates: TaxRate[]) => rates.map((t) => `${t.name}|${t.rateBps}`).join(',');
  const restaurantKey = keyOf(restaurantRates);
  const groups = new Map<string, { rates: TaxRate[]; subtotal: number }>([[restaurantKey, { rates: restaurantRates, subtotal: 0 }]]);
  lines.forEach((l, i) => {
    const own = l.taxRateBps;
    const gst = own === null || own === undefined ? (l.taxable ? restaurantRates : []) : gstComponents(own);
    const rates = [...gst, ...(l.extraTaxes ?? [])].filter((t) => t.rateBps > 0);
    if (rates.length === 0) return;
    const key = keyOf(rates);
    if (!groups.has(key)) groups.set(key, { rates, subtotal: 0 });
    groups.get(key)!.subtotal += lineTotals[i];
  });

  // The discount is spread proportionally over every group (and the untaxed lines); same
  // names and rates from different groups (e.g. CGST 2.5 %) are added together. The
  // restaurant's taxes come first, then the lowest rates.
  const merged = new Map<string, TaxLine>();
  const totalBps = (rates: TaxRate[]) => rates.reduce((a, t) => a + t.rateBps, 0);
  const ordered = [...groups.entries()].sort(([a, ga], [b, gb]) =>
    a === restaurantKey ? -1 : b === restaurantKey ? 1 : totalBps(ga.rates) - totalBps(gb.rates),
  );
  for (const [key, g] of ordered) {
    if (key !== restaurantKey && g.subtotal === 0) continue;
    const base = subtotal > 0 ? g.subtotal - divRoundHalfUp(discountAmount * g.subtotal, subtotal) : 0;
    for (const t of taxFor(base, g.rates, settings.pricesIncludeTax)) {
      const k = `${t.name}|${t.rateBps}`;
      const prev = merged.get(k);
      merged.set(k, prev ? { ...prev, amount: prev.amount + t.amount, base: (prev.base ?? 0) + (t.base ?? 0) } : t);
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
