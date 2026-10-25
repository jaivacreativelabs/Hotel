import type { Types } from 'mongoose';
import type { PageMeta, TransactionDTO, TransactionQuery } from '@rb/shared';
import { env } from '../config/env.js';
import type { AuthUser } from '../middleware/auth.js';
import { BranchModel, RestaurantModel, TransactionModel, type Transaction } from '../models/index.js';
import { dayRange, formatDateTime } from '../utils/dates.js';
import { toCsv, paiseToDecimal } from '../utils/csv.js';
import { conflict, forbidden, notFound } from '../utils/errors.js';
import { toTransactionDTO } from '../utils/serialize.js';
import { escapeRegex, toObjectId } from '../utils/validate.js';
import { audit } from './audit.service.js';

type TransactionLean = Transaction & { _id: Types.ObjectId };

/**
 * Builds the MongoDB filter for a transaction query, always constrained to what the caller
 * may see. Restaurant Admins never get results outside their assigned branches.
 */
export function transactionFilter(user: AuthUser, q: Partial<TransactionQuery>): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (user.role === 'RESTAURANT_ADMIN') {
    if (q.branchId) {
      const id = toObjectId(q.branchId, 'branch');
      if (!user.branchIds.some((b) => b.equals(id))) throw forbidden('You are not assigned to this branch');
      filter.branchId = id;
    } else {
      filter.branchId = { $in: user.branchIds };
    }
    filter.restaurantId = { $in: user.restaurantIds };
  } else {
    if (q.restaurantId) filter.restaurantId = toObjectId(q.restaurantId, 'restaurant');
    if (q.branchId) filter.branchId = toObjectId(q.branchId, 'branch');
  }
  const { start, end } = dayRange(q.from, q.to, env.APP_TIMEZONE);
  if (start || end) filter.finalizedAt = { ...(start && { $gte: start }), ...(end && { $lt: end }) };
  if (q.paymentMethod) filter.paymentMethod = q.paymentMethod;
  if (q.status) filter.status = q.status;
  if (q.q) {
    const term = q.q.replace(/^#/, '').trim();
    const rx = { $regex: escapeRegex(term), $options: 'i' };
    filter.$or = [{ billNumber: rx }, { tableLabel: rx }, { customerName: rx }];
  }
  return filter;
}

export async function listTransactions(
  user: AuthUser,
  q: TransactionQuery,
): Promise<{ data: TransactionDTO[]; meta: PageMeta }> {
  const filter = transactionFilter(user, q);
  const [total, rows] = await Promise.all([
    TransactionModel.countDocuments(filter),
    TransactionModel.find(filter)
      .sort({ finalizedAt: -1, _id: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean<TransactionLean[]>(),
  ]);
  return {
    data: rows.map(toTransactionDTO),
    meta: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
  };
}

async function getAccessible(user: AuthUser, id: string) {
  const tx = await TransactionModel.findById(toObjectId(id, 'transaction')).lean<TransactionLean>();
  if (!tx) throw notFound('Transaction');
  if (user.role === 'RESTAURANT_ADMIN' && !user.branchIds.some((b) => b.equals(tx.branchId))) {
    throw notFound('Transaction');
  }
  return tx;
}

export async function getTransaction(user: AuthUser, id: string): Promise<TransactionDTO> {
  return toTransactionDTO(await getAccessible(user, id));
}

const MAX_EXPORT_ROWS = 50_000;

export async function exportTransactionsCsv(user: AuthUser, q: Partial<TransactionQuery>): Promise<string> {
  const filter = transactionFilter(user, q);
  const rows = await TransactionModel.find(filter).sort({ finalizedAt: -1 }).limit(MAX_EXPORT_ROWS).lean<TransactionLean[]>();
  const restaurants = new Map(
    (await RestaurantModel.find({ _id: { $in: [...new Set(rows.map((r) => String(r.restaurantId)))] } }).select('name').lean<{ _id: Types.ObjectId; name: string }[]>()).map(
      (r) => [String(r._id), r.name],
    ),
  );
  const branches = new Map(
    (await BranchModel.find({ _id: { $in: [...new Set(rows.map((r) => String(r.branchId)))] } }).select('name').lean<{ _id: Types.ObjectId; name: string }[]>()).map(
      (b) => [String(b._id), b.name],
    ),
  );
  return toCsv(
    [
      'Bill No.',
      'Date & Time',
      'Restaurant',
      'Branch',
      'Table',
      'Customer',
      'Items',
      'Item Count',
      'Subtotal',
      'Discount',
      'Tax',
      'Total',
      'Payment Mode',
      'Payment Status',
      'Status',
      'Cashier',
    ],
    rows.map((t) => [
      t.billNumber,
      formatDateTime(t.finalizedAt, env.APP_TIMEZONE),
      restaurants.get(String(t.restaurantId)) ?? t.restaurantSnapshot?.name ?? '',
      branches.get(String(t.branchId)) ?? t.branchSnapshot?.name ?? '',
      t.tableLabel ? `${t.tableLabel} ${t.groupName ?? ''}`.trim() : 'Takeaway',
      t.customerName ?? '',
      t.items.map((i) => `${i.name} x${i.quantity}`).join('; '),
      t.items.reduce((a, i) => a + i.quantity, 0),
      paiseToDecimal(t.subtotal),
      paiseToDecimal(t.discount?.amount ?? 0),
      paiseToDecimal(t.taxTotal),
      paiseToDecimal(t.grandTotal),
      t.paymentMethod,
      t.paymentStatus,
      t.status,
      t.createdByName ?? '',
    ]),
  );
}

/** Controlled correction workflow: COMPLETED → VOIDED | REFUNDED. Amounts are never edited. */
export async function changeTransactionStatus(
  user: AuthUser,
  id: string,
  next: 'VOIDED' | 'REFUNDED',
  reason: string,
): Promise<TransactionDTO> {
  const tx = await getAccessible(user, id);
  const updated = await TransactionModel.findOneAndUpdate(
    { _id: tx._id, status: 'COMPLETED' },
    {
      $set: {
        status: next,
        ...(next === 'REFUNDED' && { paymentStatus: 'REFUNDED' }),
        statusChange: { at: new Date(), by: user._id, byName: user.name, reason },
      },
    },
    { new: true },
  ).lean<TransactionLean>();
  if (!updated) throw conflict(`Bill ${tx.billNumber} is already ${tx.status.toLowerCase()}`, 'INVALID_STATUS');
  await audit(user, {
    action: next === 'VOIDED' ? 'TRANSACTION_VOIDED' : 'TRANSACTION_REFUNDED',
    entityType: 'Transaction',
    entityId: tx._id,
    restaurantId: tx.restaurantId,
    branchId: tx.branchId,
    summary: `${next === 'VOIDED' ? 'Voided' : 'Refunded'} bill ${tx.billNumber} (${tx.grandTotal} paise): ${reason}`,
    meta: { reason, previousStatus: tx.status },
  });
  return toTransactionDTO(updated);
}
