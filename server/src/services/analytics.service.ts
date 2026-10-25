/**
 * Super Admin analytics. Everything is aggregated in MongoDB; only COMPLETED transactions
 * count as revenue. Voided and refunded bills are reported separately.
 */
import type { Types } from 'mongoose';
import type { AnalyticsOverviewDTO, AnalyticsPoint, AnalyticsQuery, PaymentMethod } from '@rb/shared';
import { env } from '../config/env.js';
import { BranchModel, RestaurantModel, TransactionModel } from '../models/index.js';
import { addDays, dayRange } from '../utils/dates.js';
import { badRequest } from '../utils/errors.js';
import { toCsv, paiseToDecimal } from '../utils/csv.js';
import { toObjectId } from '../utils/validate.js';

const MAX_RANGE_DAYS = 731;

function baseMatch(q: AnalyticsQuery) {
  if (q.from > q.to) throw badRequest('"from" must be on or before "to"');
  const days = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 + 1;
  if (days > MAX_RANGE_DAYS) throw badRequest('Choose a range of at most two years');
  const { start, end } = dayRange(q.from, q.to, env.APP_TIMEZONE);
  const match: Record<string, unknown> = { finalizedAt: { $gte: start, $lt: end } };
  if (q.restaurantId) match.restaurantId = toObjectId(q.restaurantId, 'restaurant');
  if (q.branchId) match.branchId = toObjectId(q.branchId, 'branch');
  return match;
}

interface Bucket {
  _id: unknown;
  sales: number;
  bills: number;
}

const sumStage = { sales: { $sum: '$grandTotal' }, bills: { $sum: 1 } };
const point = (b: Bucket): AnalyticsPoint => ({ key: String(b._id), sales: b.sales, bills: b.bills });

function fillDays(from: string, to: string, points: AnalyticsPoint[]): AnalyticsPoint[] {
  const byKey = new Map(points.map((p) => [p.key, p]));
  const out: AnalyticsPoint[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(byKey.get(d) ?? { key: d, sales: 0, bills: 0 });
  return out;
}

function fillMonths(from: string, to: string, points: AnalyticsPoint[]): AnalyticsPoint[] {
  const byKey = new Map(points.map((p) => [p.key, p]));
  const out: AnalyticsPoint[] = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const end = to.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (key > end) break;
    out.push(byKey.get(key) ?? { key, sales: 0, bills: 0 });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export async function analyticsOverview(q: AnalyticsQuery): Promise<AnalyticsOverviewDTO> {
  const match = baseMatch(q);
  const tz = env.APP_TIMEZONE;
  const [facets] = await TransactionModel.aggregate<{
    summary: { sales: number; bills: number; tax: number }[];
    daily: Bucket[];
    monthly: Bucket[];
    byRestaurant: Bucket[];
    byBranch: (Bucket & { restaurantId: Types.ObjectId })[];
    byPaymentMethod: Bucket[];
    excluded: (Bucket & { _id: string })[];
    topItems: { _id: Types.ObjectId; name: string; quantity: number; sales: number }[];
    topCategories: { _id: string; quantity: number; sales: number }[];
    hourly: Bucket[];
  }>([
    { $match: match },
    {
      $facet: {
        summary: [
          { $match: { status: 'COMPLETED' } },
          { $group: { _id: null, ...sumStage, tax: { $sum: '$taxTotal' } } },
        ],
        daily: [
          { $match: { status: 'COMPLETED' } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$finalizedAt', timezone: tz } }, ...sumStage } },
        ],
        monthly: [
          { $match: { status: 'COMPLETED' } },
          { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$finalizedAt', timezone: tz } }, ...sumStage } },
        ],
        byRestaurant: [{ $match: { status: 'COMPLETED' } }, { $group: { _id: '$restaurantId', ...sumStage } }],
        byBranch: [
          { $match: { status: 'COMPLETED' } },
          { $group: { _id: '$branchId', restaurantId: { $first: '$restaurantId' }, ...sumStage } },
        ],
        byPaymentMethod: [{ $match: { status: 'COMPLETED' } }, { $group: { _id: '$paymentMethod', ...sumStage } }],
        excluded: [{ $match: { status: { $ne: 'COMPLETED' } } }, { $group: { _id: '$status', ...sumStage } }],
        // Item-level ranking uses the immutable item snapshots stored on each bill.
        topItems: [
          { $match: { status: 'COMPLETED' } },
          { $unwind: '$items' },
          {
            $group: {
              _id: '$items.menuItemId',
              name: { $last: '$items.name' },
              quantity: { $sum: '$items.quantity' },
              sales: { $sum: '$items.lineTotal' },
            },
          },
          { $sort: { sales: -1, quantity: -1 } },
          { $limit: 10 },
        ],
        topCategories: [
          { $match: { status: 'COMPLETED' } },
          { $unwind: '$items' },
          {
            $group: {
              _id: { $ifNull: [{ $cond: [{ $eq: ['$items.categoryName', ''] }, null, '$items.categoryName'] }, 'Other'] },
              quantity: { $sum: '$items.quantity' },
              sales: { $sum: '$items.lineTotal' },
            },
          },
          { $sort: { sales: -1 } },
          { $limit: 10 },
        ],
        hourly: [
          { $match: { status: 'COMPLETED' } },
          { $group: { _id: { $dateToString: { format: '%H', date: '$finalizedAt', timezone: tz } }, ...sumStage } },
        ],
      },
    },
  ]);

  const restaurants = await RestaurantModel.find({
    _id: { $in: [...facets.byRestaurant.map((b) => b._id), ...facets.byBranch.map((b) => b.restaurantId)] },
  })
    .select('name')
    .lean<{ _id: Types.ObjectId; name: string }[]>();
  const branches = await BranchModel.find({ _id: { $in: facets.byBranch.map((b) => b._id) } })
    .select('name')
    .lean<{ _id: Types.ObjectId; name: string }[]>();
  const rName = new Map(restaurants.map((r) => [String(r._id), r.name]));
  const bName = new Map(branches.map((b) => [String(b._id), b.name]));
  const s = facets.summary[0] ?? { sales: 0, bills: 0, tax: 0 };
  const excluded = (status: string) => facets.excluded.find((e) => e._id === status) ?? { sales: 0, bills: 0 };
  const bySales = (a: AnalyticsPoint, b: AnalyticsPoint) => b.sales - a.sales;

  return {
    range: { from: q.from, to: q.to, timezone: tz },
    summary: {
      totalSales: s.sales,
      billCount: s.bills,
      averageBill: s.bills ? Math.round(s.sales / s.bills) : 0,
      taxTotal: s.tax,
    },
    excluded: {
      voidedCount: excluded('VOIDED').bills,
      voidedAmount: excluded('VOIDED').sales,
      refundedCount: excluded('REFUNDED').bills,
      refundedAmount: excluded('REFUNDED').sales,
    },
    daily: fillDays(q.from, q.to, facets.daily.map(point)),
    monthly: fillMonths(q.from, q.to, facets.monthly.map(point)),
    byRestaurant: facets.byRestaurant.map((b) => ({ ...point(b), name: rName.get(String(b._id)) ?? 'Unknown' })).sort(bySales),
    byBranch: facets.byBranch
      .map((b) => ({
        ...point(b),
        name: bName.get(String(b._id)) ?? 'Unknown',
        restaurantName: rName.get(String(b.restaurantId)) ?? 'Unknown',
      }))
      .sort(bySales),
    byPaymentMethod: facets.byPaymentMethod
      .map((b) => ({ ...point(b), key: String(b._id) as PaymentMethod }))
      .sort(bySales),
    topItems: facets.topItems.map((i) => ({ key: String(i._id), name: i.name, quantity: i.quantity, sales: i.sales })),
    topCategories: facets.topCategories.map((c) => ({ key: c._id, name: c._id, quantity: c.quantity, sales: c.sales })),
    hourly: fillHours(facets.hourly.map(point)),
  };
}

function fillHours(points: AnalyticsPoint[]): AnalyticsPoint[] {
  const byKey = new Map(points.map((p) => [p.key, p]));
  return Array.from({ length: 24 }, (_, h) => {
    const key = String(h).padStart(2, '0');
    return byKey.get(key) ?? { key, sales: 0, bills: 0 };
  });
}

// ---------------- CSV reports ----------------

const avg = (p: AnalyticsPoint) => paiseToDecimal(p.bills ? Math.round(p.sales / p.bills) : 0);

export async function salesReportCsv(q: AnalyticsQuery & { granularity: 'day' | 'month' }): Promise<string> {
  const o = await analyticsOverview(q);
  const series = q.granularity === 'month' ? o.monthly : o.daily;
  return toCsv(
    [q.granularity === 'month' ? 'Month' : 'Date', 'Completed Bills', 'Sales', 'Average Bill'],
    series.map((p) => [p.key, p.bills, paiseToDecimal(p.sales), avg(p)]),
  );
}

export async function restaurantReportCsv(q: AnalyticsQuery): Promise<string> {
  const o = await analyticsOverview(q);
  return toCsv(
    ['Restaurant', 'Completed Bills', 'Sales', 'Average Bill'],
    o.byRestaurant.map((p) => [p.name, p.bills, paiseToDecimal(p.sales), avg(p)]),
  );
}

export async function branchReportCsv(q: AnalyticsQuery): Promise<string> {
  const o = await analyticsOverview(q);
  return toCsv(
    ['Restaurant', 'Branch', 'Completed Bills', 'Sales', 'Average Bill'],
    o.byBranch.map((p) => [p.restaurantName, p.name, p.bills, paiseToDecimal(p.sales), avg(p)]),
  );
}
