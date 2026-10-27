import { describe, expect, it } from 'vitest';
import {
  bpsToPercent,
  calculateBill,
  divRoundHalfUp,
  formatMoney,
  parseRupeesToPaise,
  paiseToRupeesInput,
} from './money.js';

const noTax = { taxes: [], pricesIncludeTax: false };
const gst5 = {
  taxes: [
    { name: 'CGST', rateBps: 250 },
    { name: 'SGST', rateBps: 250 },
  ],
  pricesIncludeTax: false,
};

describe('divRoundHalfUp', () => {
  it('rounds halves up', () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(4, 3)).toBe(1);
    expect(divRoundHalfUp(0, 7)).toBe(0);
  });
  it('rejects bad input', () => {
    expect(() => divRoundHalfUp(1.5, 2)).toThrow();
    expect(() => divRoundHalfUp(1, 0)).toThrow();
  });
});

describe('calculateBill', () => {
  it('sums lines without tax', () => {
    const t = calculateBill(
      [
        { unitPrice: 3000, quantity: 2, taxable: true },
        { unitPrice: 5000, quantity: 1, taxable: true },
      ],
      noTax,
    );
    expect(t.lineTotals).toEqual([6000, 5000]);
    expect(t.subtotal).toBe(11000);
    expect(t.grandTotal).toBe(11000);
    expect(t.taxes).toEqual([]);
  });

  it('adds exclusive tax per component with half-up rounding', () => {
    // 3 × ₹33.33 = ₹99.99 ; 2.5 % = 249.975 paise → 250
    const t = calculateBill([{ unitPrice: 3333, quantity: 3, taxable: true }], gst5);
    expect(t.subtotal).toBe(9999);
    expect(t.taxes.map((x) => x.amount)).toEqual([250, 250]);
    expect(t.taxTotal).toBe(500);
    expect(t.grandTotal).toBe(10499);
  });

  it('skips non-taxable lines', () => {
    const t = calculateBill(
      [
        { unitPrice: 10000, quantity: 1, taxable: true },
        { unitPrice: 10000, quantity: 1, taxable: false },
      ],
      gst5,
    );
    expect(t.taxTotal).toBe(500);
    expect(t.grandTotal).toBe(20500);
  });

  it('extracts inclusive tax without changing the total', () => {
    const t = calculateBill([{ unitPrice: 10500, quantity: 1, taxable: true }], {
      ...gst5,
      pricesIncludeTax: true,
    });
    expect(t.grandTotal).toBe(10500);
    expect(t.taxTotal).toBe(500);
    expect(t.taxes[0].amount + t.taxes[1].amount).toBe(500);
  });

  it('applies percent and flat discounts before tax', () => {
    const lines = [{ unitPrice: 10000, quantity: 1, taxable: true }];
    const pct = calculateBill(lines, gst5, { type: 'PERCENT', value: 1000 });
    expect(pct.discountAmount).toBe(1000);
    expect(pct.taxTotal).toBe(450);
    expect(pct.grandTotal).toBe(9450);

    const flat = calculateBill(lines, noTax, { type: 'FLAT', value: 50000 });
    expect(flat.discountAmount).toBe(10000); // capped at subtotal
    expect(flat.grandTotal).toBe(0);
  });

  it("uses an item's own GST %, split into CGST and SGST", () => {
    const t = calculateBill(
      [
        { unitPrice: 10000, quantity: 1, taxable: true, taxRateBps: 500 },
        { unitPrice: 10000, quantity: 1, taxable: true, taxRateBps: 1800 },
        { unitPrice: 10000, quantity: 1, taxable: false, taxRateBps: 0 },
      ],
      noTax,
    );
    expect(t.taxes).toEqual([
      { name: 'CGST', rateBps: 250, amount: 250 },
      { name: 'SGST', rateBps: 250, amount: 250 },
      { name: 'CGST', rateBps: 900, amount: 900 },
      { name: 'SGST', rateBps: 900, amount: 900 },
    ]);
    expect(t.taxTotal).toBe(2300);
    expect(t.grandTotal).toBe(32300);
  });

  it('adds up the same rate from the restaurant and from items', () => {
    const t = calculateBill(
      [
        { unitPrice: 10000, quantity: 1, taxable: true }, // restaurant CGST + SGST 2.5 %
        { unitPrice: 10000, quantity: 1, taxable: true, taxRateBps: 500 },
      ],
      gst5,
    );
    expect(t.taxes).toEqual([
      { name: 'CGST', rateBps: 250, amount: 500 },
      { name: 'SGST', rateBps: 250, amount: 500 },
    ]);
    expect(t.grandTotal).toBe(21000);
  });

  it('spreads a discount over items with different rates', () => {
    const t = calculateBill(
      [
        { unitPrice: 10000, quantity: 1, taxable: true, taxRateBps: 500 },
        { unitPrice: 10000, quantity: 1, taxable: true, taxRateBps: 1800 },
      ],
      noTax,
      { type: 'PERCENT', value: 1000 },
    );
    // each line's base is ₹90 after 10 % off
    expect(t.taxes.map((x) => x.amount)).toEqual([225, 225, 810, 810]);
    expect(t.grandTotal).toBe(18000 + 2070);
  });

  it("extracts an item's own GST from prices that include tax", () => {
    const t = calculateBill([{ unitPrice: 11800, quantity: 1, taxable: true, taxRateBps: 1800 }], { taxes: [], pricesIncludeTax: true });
    expect(t.grandTotal).toBe(11800);
    expect(t.taxTotal).toBe(1800);
  });

  it('handles an empty bill', () => {
    const t = calculateBill([], gst5, { type: 'FLAT', value: 100 });
    expect(t.grandTotal).toBe(0);
    expect(t.discountAmount).toBe(0);
  });
});

describe('formatting', () => {
  it('formats paise', () => {
    expect(formatMoney(3000)).toBe('₹ 30');
    expect(formatMoney(3050)).toBe('₹ 30.50');
    expect(formatMoney(12345600)).toBe('₹ 1,23,456');
  });
  it('parses rupees without floats', () => {
    expect(parseRupeesToPaise('30')).toBe(3000);
    expect(parseRupeesToPaise('30.5')).toBe(3050);
    expect(parseRupeesToPaise('0.07')).toBe(7);
    expect(parseRupeesToPaise('1.234')).toBeNull();
    expect(parseRupeesToPaise('-1')).toBeNull();
    expect(parseRupeesToPaise('abc')).toBeNull();
    expect(paiseToRupeesInput(3050)).toBe('30.50');
    expect(bpsToPercent(250)).toBe('2.5');
    expect(bpsToPercent(1800)).toBe('18');
  });
});
