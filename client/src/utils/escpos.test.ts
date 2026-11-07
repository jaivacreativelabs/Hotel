import type { TransactionDTO } from '@rb/shared';
import { describe, expect, it } from 'vitest';
import { receiptCommands, toAscii, twoColumns, wrap } from './escpos';

const item = (n: number, name: string, unitPrice: number, quantity: number) => ({
  menuItemId: `m${n}`,
  name,
  categoryName: 'Tiffin',
  imageUrl: null,
  unitPrice,
  quantity,
  taxable: false,
  taxRateBps: null,
  extraTaxes: [],
  lineTotal: unitPrice * quantity,
});

const bill = (over: Partial<TransactionDTO> = {}): TransactionDTO => ({
  id: 't1',
  billNumber: 'ITH0230',
  restaurantId: 'r',
  branchId: 'b',
  tableId: null,
  tableLabel: '',
  type: 'COUNTER',
  orderType: 'TAKEAWAY',
  manual: false,
  groupName: '',
  guestCount: 0,
  customerName: '',
  restaurantSnapshot: { name: 'Idly Tiffin House', address: '12, Main Road, Anna Nagar, Chennai', phone: '98765 43210', gstin: '', receiptFooter: 'Thank you! Visit again', logoUrl: '' },
  branchSnapshot: { name: 'Idly Tiffin House', code: 'ITH', address: '12, Main Road, Anna Nagar, Chennai', phone: '' },
  items: [item(1, 'Idly (2 pcs)', 4000, 2), item(2, 'Ghee Podi Onion Uthappam Special', 12000, 1)],
  itemCount: 3,
  subtotal: 20000,
  discount: null,
  taxes: [],
  taxTotal: 0,
  grandTotal: 20000,
  pricesIncludeTax: true,
  paymentMethod: 'CASH',
  payments: [{ method: 'CASH', amount: 20000 }],
  paymentStatus: 'PAID',
  status: 'COMPLETED',
  statusChange: null,
  createdByName: 'Anna Nagar Admin',
  finalizedAt: '2026-11-02T08:30:00.000Z',
  editCount: 0,
  editedAt: null,
  editedByName: '',
  editableUntil: null,
  ...over,
} as TransactionDTO);

/** The printed text lines (commands stripped). */
const printedLines = (bytes: Uint8Array) =>
  new TextDecoder('latin1')
    .decode(bytes)
    // eslint-disable-next-line no-control-regex -- printer commands are control characters
    .replace(/\x1b[@]|\x1b[aEd][\s\S]|\x1d![\s\S]|\x1dVB\x00/g, '')
    .split('\n')
    .filter((l) => l.trim());

describe('toAscii', () => {
  it('spells the rupee sign out and drops what a printer cannot show', () => {
    expect(toAscii('₹ 1,200')).toBe('Rs.1,200');
    expect(toAscii('Café – “Special”')).toBe('Cafe - "Special"');
    expect(toAscii('இட்லி')).toMatch(/^\?+$/);
  });
});

describe('wrap / twoColumns', () => {
  it('keeps every line inside the width', () => {
    for (const l of wrap('Ghee Podi Onion Uthappam Extraordinarilylongword', 10)) expect(l.length).toBeLessThanOrEqual(10);
  });
  it('puts the right text against the right edge', () => {
    expect(twoColumns('Subtotal', '200', 20)).toEqual(['Subtotal' + ' '.repeat(9) + '200']);
    expect(twoColumns('A very long label here', '200', 12).every((l) => l.length <= 12)).toBe(true);
  });
});

describe('receiptCommands', () => {
  it.each([32, 48])('lays the bill out in %i columns', (cols) => {
    const lines = printedLines(receiptCommands(bill(), cols));
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(cols);
    const text = lines.join('\n');
    expect(text).toContain('Idly Tiffin House');
    expect(text).toContain('Bill: ITH0230');
    expect(text).toContain('Take Away');
    expect(text).toMatch(/TOTAL\s+Rs\.200/);
    expect(text).toContain('Thank you! Visit again');
  });

  it('starts by resetting the printer and ends by feeding and cutting', () => {
    const bytes = receiptCommands(bill(), 32);
    expect([...bytes.slice(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...bytes.slice(-7)]).toEqual([0x1b, 0x64, 4, 0x1d, 0x56, 0x42, 0]);
  });

  it('marks a voided bill', () => {
    expect(printedLines(receiptCommands(bill({ status: 'VOIDED' }), 32)).join('\n')).toContain('*** VOIDED ***');
  });

  it('prints no logo, no "@ price" line and a normal-size total', () => {
    const withLogo = bill({ restaurantSnapshot: { ...bill().restaurantSnapshot, logoUrl: '/logo.png' } });
    const bytes = [...receiptCommands(withLogo, 32)];
    expect(bytes.some((b, i) => b === 0x1d && bytes[i + 1] === 0x76)).toBe(false);
    expect(printedLines(Uint8Array.from(bytes)).some((l) => l.trim().startsWith('@'))).toBe(false);
    const total = bytes.findIndex((_, i) => String.fromCharCode(...bytes.slice(i, i + 5)) === 'TOTAL');
    const sizes = bytes.slice(0, total).flatMap((b, i, a) => (b === 0x1d && a[i + 1] === 0x21 ? [a[i + 2]] : []));
    expect(sizes.at(-1)).toBe(0);
  });
});
