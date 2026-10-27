import { describe, expect, it } from 'vitest';
import { itemTaxShares } from './format';

const item = (name: string, lineTotal: number, taxRateBps: number | null) => ({ name, lineTotal, taxRateBps, taxable: taxRateBps !== 0, extraTaxes: [] });

describe('itemTaxShares', () => {
  it("puts an item's GST into that item only", () => {
    const items = [item('Idly (Full)', 3000, 500), item('Dosa', 5000, 0)];
    expect(itemTaxShares([{ name: 'GST', rateBps: 500, amount: 150 }], items)).toEqual([150, 0]);
  });

  it('splits one tax line over its items so the shares add up exactly', () => {
    const items = [item('Idly', 1000, 500), item('Dosa', 1000, 500), item('Vada', 1000, 500)];
    const shares = itemTaxShares([{ name: 'GST', rateBps: 500, amount: 151 }], items);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(151);
  });

  it("splits a restaurant's CGST + SGST over the items without their own GST", () => {
    const items = [item('Tea', 2000, null), item('Cola', 4000, 1800)];
    const taxes = [
      { name: 'CGST', rateBps: 250, amount: 50 },
      { name: 'SGST', rateBps: 250, amount: 50 },
      { name: 'GST', rateBps: 1800, amount: 720 },
    ];
    expect(itemTaxShares(taxes, items)).toEqual([100, 720]);
  });
});
