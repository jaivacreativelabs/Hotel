/**
 * The bill as ESC/POS commands, the language of thermal receipt printers – what a Bluetooth
 * printer is sent (services/btPrinter.ts). Same content as components/Receipt.tsx, as text.
 */
import { ORDER_TYPE_LABEL, ownBranchName, type TransactionDTO } from '@rb/shared';
import { formatDateTime, formatMoney, itemTaxShares, itemTaxText, PAYMENT_LABEL, STATUS_LABEL } from './format';

/** Roll width → characters per line (the printer's standard font): 58 mm prints 32, 80 mm 48. */
export type PaperWidth = 58 | 80;
export const PAPER_COLUMNS: Record<PaperWidth, number> = { 58: 32, 80: 48 };

const ESC = 0x1b;
const GS = 0x1d;
const INIT = [ESC, 0x40];
const align = (n: 0 | 1 | 2) => [ESC, 0x61, n];
const bold = (on: boolean) => [ESC, 0x45, on ? 1 : 0];
/** 0 normal, 0x01 double height, 0x11 double width and height */
const size = (n: number) => [GS, 0x21, n];
const FEED_AND_CUT = [ESC, 0x64, 4, GS, 0x56, 0x42, 0];

/** Printers have no ₹ or Tamil letters in their basic character set: plain ASCII only. */
export function toAscii(s: string): string {
  return s
    .replace(/₹\s?/g, 'Rs.')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[\u00a0\u2000-\u200b]/g, ' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

/** Breaks text into lines of at most `width` characters, at spaces where it can. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > width) {
      if (line) lines.push(line);
      lines.push(w.slice(0, width));
      w = w.slice(width);
      line = '';
    }
    if (!w) continue;
    if (!line) line = w;
    else if (line.length + 1 + w.length <= width) line += ' ' + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/** `left` and `right` on one line, `right` against the right edge (left wraps if it must). */
export function twoColumns(left: string, right: string, width: number): string[] {
  const room = width - right.length - 1;
  const lines = wrap(left, Math.max(room, 1));
  const last = lines[lines.length - 1];
  if (last.length + 1 + right.length <= width) lines[lines.length - 1] = last + ' '.repeat(width - last.length - right.length) + right;
  else lines.push(' '.repeat(Math.max(width - right.length, 0)) + right);
  return lines;
}

const money = (paise: number) => toAscii(formatMoney(paise)).replace('Rs.', '');

/** The bill as printer commands, for a roll `columns` characters wide. */
export function receiptCommands(t: TransactionDTO, columns: number): Uint8Array {
  const out: number[] = [...INIT];
  const text = (s: string) => {
    for (const c of toAscii(s)) out.push(c.charCodeAt(0));
    out.push(0x0a);
  };
  const lines = (ls: string[]) => ls.forEach(text);
  const centred = (s: string) => lines(wrap(toAscii(s), columns));
  const rule = () => text('-'.repeat(columns));

  // No logo: the bill is text only.
  out.push(...align(1));
  out.push(...bold(true), ...size(0x01));
  centred(t.restaurantSnapshot.name);
  out.push(...size(0));
  if (ownBranchName(t.restaurantSnapshot.name, t.branchSnapshot.name)) centred(t.branchSnapshot.name);
  out.push(...bold(false));
  if (t.branchSnapshot.address) centred(t.branchSnapshot.address);
  const phone = t.branchSnapshot.phone || t.restaurantSnapshot.phone;
  if (phone) centred(`Ph: ${phone}`);
  if (t.restaurantSnapshot.gstin) centred(`GSTIN: ${t.restaurantSnapshot.gstin}`);

  out.push(...align(0));
  rule();
  lines(twoColumns(`Bill: ${t.billNumber}`, toAscii(t.tableLabel ? `Table ${t.tableLabel}` : ORDER_TYPE_LABEL[t.orderType]), columns));
  text(formatDateTime(t.finalizedAt));
  if (t.editCount > 0 && t.editedAt) text(`Revised: ${formatDateTime(t.editedAt)}`);
  if (t.customerName) lines(wrap(toAscii(`Customer: ${t.customerName}`), columns));
  lines(wrap(toAscii(`Cashier: ${t.createdByName}`), columns));
  if (t.status !== 'COMPLETED') {
    out.push(...align(1), ...bold(true));
    text(`*** ${STATUS_LABEL[t.status].toUpperCase()} ***`);
    out.push(...bold(false), ...align(0));
  }

  // Item | Qty | Amount; the item's name wraps inside its own column.
  rule();
  const qtyW = 4;
  const amountW = columns >= 48 ? 12 : 9;
  const itemW = columns - qtyW - amountW;
  const row = (item: string, qty: string, amount: string) => item.padEnd(itemW) + qty.padStart(qtyW) + amount.padStart(amountW);
  out.push(...bold(true));
  text(row('Item', 'Qty', 'Amount'));
  out.push(...bold(false));
  const taxShares = itemTaxShares(t.taxes, t.items);
  t.items.forEach((i, n) => {
    const name = wrap(toAscii(i.name), itemW - 1);
    text(row(name[0], String(i.quantity), money(i.lineTotal + (t.pricesIncludeTax ? 0 : taxShares[n]))));
    lines(name.slice(1));
    // No "@ price" line; an item with tax still says so.
    const tax = itemTaxText(i);
    if (tax) lines(wrap(toAscii(t.pricesIncludeTax ? `(incl. ${tax})` : `+ ${tax}`), itemW - 1));
  });

  rule();
  // Taxes are inside each item's amount, so the subtotal includes them too.
  lines(twoColumns('Subtotal', money(t.subtotal + (t.pricesIncludeTax ? 0 : t.taxTotal)), columns));
  if (t.discount && t.discount.amount > 0) lines(twoColumns('Discount', `-${money(t.discount.amount)}`, columns));
  // Bold at the normal size: double height alone stretched the letters tall and thin.
  out.push(...bold(true));
  lines(twoColumns('TOTAL', `Rs.${money(t.grandTotal)}`, columns));
  out.push(...bold(false));
  if (t.payments.length > 1) t.payments.forEach((p) => lines(twoColumns(`Paid by ${PAYMENT_LABEL[p.method]}`, money(p.amount), columns)));
  else lines(twoColumns('Paid by', PAYMENT_LABEL[t.paymentMethod], columns));
  rule();
  if (t.restaurantSnapshot.receiptFooter) {
    out.push(...align(1));
    centred(t.restaurantSnapshot.receiptFooter);
  }
  out.push(...align(0), ...FEED_AND_CUT);
  return Uint8Array.from(out);
}
