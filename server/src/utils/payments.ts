import { formatMoney, mainPaymentMethod, type PaymentMethod, type PaymentPart } from '@rb/shared';
import type { PipelineStage } from 'mongoose';
import { badRequest } from './errors.js';

/**
 * How a bill is stored as paid: `payments` holds the parts of a split payment and stays empty
 * for a bill paid one way; `paymentMethod` is then the main mode (most money).
 */
export function resolvePayments(
  paymentMethod: PaymentMethod,
  parts: PaymentPart[] | undefined,
  grandTotal: number,
): { paymentMethod: PaymentMethod; payments: PaymentPart[] } {
  if (!parts) return { paymentMethod, payments: [] };
  const sum = parts.reduce((a, p) => a + p.amount, 0);
  if (sum !== grandTotal) {
    throw badRequest(`The split adds up to ${formatMoney(sum)} but the bill is ${formatMoney(grandTotal)}`, 'SPLIT_MISMATCH');
  }
  return { paymentMethod: mainPaymentMethod(parts), payments: parts.map((p) => ({ method: p.method, amount: p.amount })) };
}

/**
 * Aggregation stages giving one `pay` document ({ method, amount }) per payment part, so totals
 * by payment mode count each part of a split bill under its own mode.
 */
export const unwindPayments: PipelineStage.FacetPipelineStage[] = [
  {
    $addFields: {
      pay: {
        $cond: [{ $gt: [{ $size: { $ifNull: ['$payments', []] } }, 0] }, '$payments', [{ method: '$paymentMethod', amount: '$grandTotal' }]],
      },
    },
  },
  { $unwind: '$pay' },
];
