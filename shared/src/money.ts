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
  const taxableSubtotal = lineTotals.reduce((a, t, i) => (lines[i].taxable ? a + t : a), 0);

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

  // The discount is spread proportionally over taxable and non-taxable lines.
  const taxableBase =
    subtotal > 0 ? taxableSubtotal - divRoundHalfUp(discountAmount * taxableSubtotal, subtotal) : 0;

  const rates = settings.taxes.filter((t) => t.rateBps > 0);
  const totalBps = rates.reduce((a, t) => a + t.rateBps, 0);
  let taxes: TaxLine[] = [];
  let taxTotal = 0;
  let grandTotal = afterDiscount;

  if (rates.length > 0 && taxableBase > 0) {
    if (!settings.pricesIncludeTax) {
      taxes = rates.map((t) => ({ ...t, amount: divRoundHalfUp(taxableBase * t.rateBps, 10_000) }));
      taxTotal = taxes.reduce((a, t) => a + t.amount, 0);
      grandTotal = afterDiscount + taxTotal;
    } else {
      const net = divRoundHalfUp(taxableBase * 10_000, 10_000 + totalBps);
      taxTotal = taxableBase - net;
      let allocated = 0;
      taxes = rates.map((t, i) => {
        const amount =
          i === rates.length - 1 ? taxTotal - allocated : divRoundHalfUp(net * t.rateBps, 10_000);
        allocated += amount;
        return { ...t, amount };
      });
    }
  } else {
    taxes = rates.map((t) => ({ ...t, amount: 0 }));
  }

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
