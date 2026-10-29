/**
 * Branch expenses (groceries, gas, salary …). Restaurant Admins record them for their branch,
 * may correct them any time and delete one for EXPENSE_EDIT_WINDOW_MINUTES; the Super Admin sees
 * every branch and can change them any time. They are taken off the day's sale in the daily report.
 */
import type { Types } from 'mongoose';
import {
  placeName,
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_EDIT_WINDOW_MINUTES,
  formatMoney,
  type ExpenseCategory,
  type ExpenseDTO,
  type ExpenseInput,
  type ExpenseListDTO,
  type ExpenseQuery,
} from '@rb/shared';
import { env } from '../config/env.js';
import type { AuthUser } from '../middleware/auth.js';
import type { BranchScope } from '../middleware/scope.js';
import { BranchModel, ExpenseModel, RestaurantModel, type Expense } from '../models/index.js';
import { todayIn } from '../utils/dates.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { escapeRegex, toObjectId } from '../utils/validate.js';
import { audit } from './audit.service.js';

type ExpenseLean = Expense & { _id: Types.ObjectId; createdAt: Date };

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

export function expenseEditableUntil(e: Pick<ExpenseLean, 'createdAt'>, now = Date.now()): string | null {
  const until = new Date(e.createdAt).getTime() + EXPENSE_EDIT_WINDOW_MINUTES * 60_000;
  return until > now ? new Date(until).toISOString() : null;
}

function toExpenseDTO(e: ExpenseLean, branchName: string): ExpenseDTO {
  return {
    id: String(e._id),
    restaurantId: String(e.restaurantId),
    branchId: String(e.branchId),
    branchName,
    date: e.date,
    category: e.category,
    amount: e.amount,
    paymentMethod: e.paymentMethod,
    note: e.note ?? '',
    createdByName: e.createdByName ?? '',
    createdAt: iso(e.createdAt) ?? '',
    editedByName: e.editedByName ?? '',
    editedAt: iso(e.editedAt),
    editableUntil: expenseEditableUntil(e),
  };
}

/** Where each expense was spent, as the app names it: the restaurant (plus its location when it has several). */
async function branchNames(ids: Types.ObjectId[]): Promise<Map<string, string>> {
  const rows = await BranchModel.find({ _id: { $in: [...new Set(ids.map(String))] } })
    .select('name restaurantId')
    .lean<{ _id: Types.ObjectId; name: string; restaurantId: Types.ObjectId }[]>();
  const restaurants = await RestaurantModel.find({ _id: { $in: rows.map((b) => b.restaurantId) } })
    .select('name')
    .lean<{ _id: Types.ObjectId; name: string }[]>();
  const restaurantName = new Map(restaurants.map((r) => [String(r._id), r.name]));
  return new Map(rows.map((b) => [String(b._id), placeName(restaurantName.get(String(b.restaurantId)) ?? '', b.name)]));
}

/** Filter limited to what the caller may see: Restaurant Admins only ever get their own branch. */
function expenseFilter(user: AuthUser, q: Partial<ExpenseQuery>): Record<string, unknown> {
  const filter: Record<string, unknown> = { status: 'ACTIVE' };
  if (user.role !== 'SUPER_ADMIN') {
    if (q.branchId) {
      const id = toObjectId(q.branchId, 'branch');
      if (!user.branchIds.some((b) => b.equals(id))) throw forbidden('You are not assigned to this restaurant');
      filter.branchId = id;
    } else {
      filter.branchId = { $in: user.branchIds };
    }
    filter.restaurantId = { $in: user.restaurantIds };
  } else {
    if (q.restaurantId) filter.restaurantId = toObjectId(q.restaurantId, 'restaurant');
    if (q.branchId) filter.branchId = toObjectId(q.branchId, 'branch');
  }
  if (q.from || q.to) filter.date = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  if (q.category) filter.category = q.category;
  if (q.q) filter.note = { $regex: escapeRegex(q.q), $options: 'i' };
  return filter;
}

export async function listExpenses(user: AuthUser, q: ExpenseQuery): Promise<ExpenseListDTO> {
  const filter = expenseFilter(user, q);
  const [total, rows, byCategory] = await Promise.all([
    ExpenseModel.countDocuments(filter),
    ExpenseModel.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean<ExpenseLean[]>(),
    ExpenseModel.aggregate<{ _id: ExpenseCategory; amount: number; count: number }>([
      { $match: filter },
      { $group: { _id: '$category', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { amount: -1 } },
    ]),
  ]);
  const names = await branchNames(rows.map((r) => r.branchId));
  return {
    expenses: rows.map((r) => toExpenseDTO(r, names.get(String(r.branchId)) ?? '')),
    meta: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
    totalAmount: byCategory.reduce((a, c) => a + c.amount, 0),
    byCategory: byCategory.map((c) => ({ category: c._id, amount: c.amount, count: c.count })),
  };
}

function assertValid(input: ExpenseInput) {
  if (input.date > todayIn(env.APP_TIMEZONE)) throw badRequest('The date cannot be in the future');
  // "Other" says nothing by itself – the note tells what the money was for.
  if (input.category === 'OTHER' && !input.note?.trim()) throw badRequest('Type what the money was spent on');
}

const expenseText = (e: Pick<Expense, 'category' | 'amount' | 'date'>) =>
  `${EXPENSE_CATEGORY_LABEL[e.category]} ${formatMoney(e.amount)} on ${e.date}`;

export async function createExpense(user: AuthUser, scope: BranchScope, input: ExpenseInput): Promise<ExpenseDTO> {
  assertValid(input);
  const [created] = await ExpenseModel.create([
    {
      restaurantId: scope.restaurant._id,
      branchId: scope.branch._id,
      date: input.date,
      category: input.category,
      amount: input.amount,
      paymentMethod: input.paymentMethod,
      note: input.note ?? '',
      createdBy: user._id,
      createdByName: user.name,
    },
  ]);
  const e = created.toObject() as ExpenseLean;
  await audit(user, {
    action: 'EXPENSE_ADDED',
    entityType: 'Expense',
    entityId: e._id,
    summary: `Expense added: ${expenseText(e)}`,
    restaurantId: e.restaurantId,
    branchId: e.branchId,
  });
  return toExpenseDTO(e, scope.branch.name);
}

/**
 * Loads an expense the caller may change. Other branches' expenses look like they do not exist.
 * A branch may correct its expenses any time; deleting one is limited to the first minutes.
 */
async function getChangeable(user: AuthUser, id: string, change: 'edit' | 'delete'): Promise<ExpenseLean> {
  const e = await ExpenseModel.findOne({ _id: toObjectId(id, 'expense'), status: 'ACTIVE' }).lean<ExpenseLean>();
  if (!e || (user.role !== 'SUPER_ADMIN' && !user.branchIds.some((b) => b.equals(e.branchId)))) throw notFound('Expense');
  if (change === 'delete' && user.role !== 'SUPER_ADMIN' && !expenseEditableUntil(e)) {
    throw forbidden(`An expense can only be deleted within ${EXPENSE_EDIT_WINDOW_MINUTES} minutes of adding it. Edit it instead, or ask your Super Admin.`);
  }
  return e;
}

export async function updateExpense(user: AuthUser, id: string, input: ExpenseInput): Promise<ExpenseDTO> {
  const before = await getChangeable(user, id, 'edit');
  assertValid(input);
  const updated = await ExpenseModel.findByIdAndUpdate(
    before._id,
    { $set: { ...input, note: input.note ?? '', editedAt: new Date(), editedByName: user.name } },
    { new: true },
  ).lean<ExpenseLean>();
  await audit(user, {
    action: 'EXPENSE_EDITED',
    entityType: 'Expense',
    entityId: before._id,
    summary: `Expense changed: ${expenseText(before)} → ${expenseText(updated!)}`,
    restaurantId: before.restaurantId,
    branchId: before.branchId,
  });
  return toExpenseDTO(updated!, (await branchNames([before.branchId])).get(String(before.branchId)) ?? '');
}

export async function deleteExpense(user: AuthUser, id: string): Promise<void> {
  const e = await getChangeable(user, id, 'delete');
  await ExpenseModel.updateOne({ _id: e._id }, { $set: { status: 'DELETED', editedAt: new Date(), editedByName: user.name } });
  await audit(user, {
    action: 'EXPENSE_DELETED',
    entityType: 'Expense',
    entityId: e._id,
    summary: `Expense deleted: ${expenseText(e)}`,
    restaurantId: e.restaurantId,
    branchId: e.branchId,
  });
}
