/**
 * Generates realistic demo bills (one customer each) for every active branch, spread over the
 * last N days, using each branch's real menu and the same bill calculation as the app.
 * Demo bills are numbered D00001… (real bills use B…) and tagged `isDemo`, so they can be
 * removed at any time without touching real bills.
 *
 *   npm run seed:bills                      # 10 000 bills over the last 90 days
 *   npm run seed:bills -- --count=500 --days=30
 *   npm run seed:bills -- --remove          # delete all demo bills
 */
import { Types } from 'mongoose';
import { calculateBill, type PaymentMethod } from '@rb/shared';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import type { RestaurantLean } from '../middleware/scope.js';
import {
  BranchModel,
  CategoryModel,
  MenuItemModel,
  RestaurantModel,
  TableModel,
  TransactionModel,
  UserModel,
  type MenuItem,
} from '../models/index.js';
import { audit } from '../services/audit.service.js';
import { addDays, todayIn, zonedDayStart } from '../utils/dates.js';
import { effectiveItem, restaurantSettings } from '../utils/serialize.js';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}`))?.split('=')[1];
const COUNT = Number(arg('count') ?? 10_000);
const DAYS = Number(arg('days') ?? 90);
const REMOVE = process.argv.includes('--remove');
// Add more demo bills on top of existing ones (numbering continues after the last D-number).
const APPEND = process.argv.includes('--append');

// Deterministic pseudo-random numbers so a first run can be reproduced; appends use a new seed
// so they do not repeat the same bills.
let seed = APPEND ? Date.now() | 0 : 20261025;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
function weighted<T>(options: readonly (readonly [T, number])[]): T {
  const total = options.reduce((a, [, w]) => a + w, 0);
  let r = rand() * total;
  for (const [value, w] of options) if ((r -= w) < 0) return value;
  return options[options.length - 1][0];
}

const FIRST = ['Arun', 'Priya', 'Karthik', 'Divya', 'Suresh', 'Lakshmi', 'Vijay', 'Meena', 'Ramesh', 'Anitha', 'Senthil', 'Kavya', 'Prakash', 'Deepa', 'Manoj', 'Revathi', 'Ganesh', 'Sangeetha', 'Hari', 'Nandhini', 'Rajesh', 'Swathi', 'Murali', 'Janani', 'Bala', 'Gayathri', 'Saravanan', 'Keerthana', 'Dinesh', 'Pooja', 'Ashok', 'Sowmya', 'Venkat', 'Harini', 'Mohan', 'Aishwarya', 'Kumar', 'Bhavani', 'Sathish', 'Ramya'] as const;
const LAST = ['K', 'S', 'R', 'M', 'P', 'V', 'N', 'A', 'G', 'T', 'Kumar', 'Raj', 'Iyer', 'Pillai', 'Nair', 'Reddy'] as const;
const TAGS = ['', '', '', 'Family', 'Friends', 'Couple', 'Business'] as const;
const PAYMENTS: (readonly [PaymentMethod, number])[] = [
  ['UPI', 50],
  ['CASH', 40],
  ['CARD', 10],
];
// Busy at breakfast, lunch and dinner (hours in the restaurant's time zone).
const HOURS: (readonly [number, number])[] = [
  [7, 9], [8, 12], [9, 10], [10, 5], [11, 3], [12, 8], [13, 12], [14, 7], [15, 3],
  [16, 4], [17, 5], [18, 4], [19, 7], [20, 9], [21, 6], [22, 2],
];

async function remove() {
  const res = await TransactionModel.collection.deleteMany({ isDemo: true });
  await audit(null, { action: 'DEMO_BILLS_REMOVED', entityType: 'Transaction', entityId: 'demo', summary: `Removed ${res.deletedCount} demo bills` });
  console.log(`✔ Removed ${res.deletedCount} demo bills. Real bills were not touched.`);
}

async function generate() {
  if (!APPEND && (await TransactionModel.exists({ isDemo: true }))) {
    throw new Error('Demo bills already exist. Add more with `npm run seed:bills -- --append`, or remove them with `-- --remove`.');
  }
  const restaurants = await RestaurantModel.find({ status: 'ACTIVE' }).lean<RestaurantLean[]>();
  const branches = await BranchModel.find({ status: 'ACTIVE', restaurantId: { $in: restaurants.map((r) => r._id) } }).lean();
  if (!branches.length) throw new Error('No active branches');
  const superAdmin = await UserModel.findOne({ role: 'SUPER_ADMIN' }).lean();

  // Per branch: effective menu, tables, cashier.
  const setups: Awaited<ReturnType<typeof loadSetup>>[] = [];
  for (const branch of branches) {
    const setup = await loadSetup(branch, restaurants, superAdmin);
    if (setup) setups.push(setup);
  }
  if (!setups.length) throw new Error('No branch has menu items to bill');
  return writeBills(setups as NonNullable<(typeof setups)[number]>[]);
}

type BranchLean = { _id: Types.ObjectId; restaurantId: Types.ObjectId; name: string; code: string; address?: string | null; phone?: string | null };
type UserLean = { _id: Types.ObjectId; name: string } | null;

async function loadSetup(branch: BranchLean, restaurants: RestaurantLean[], superAdmin: UserLean) {
  {
    const restaurant = restaurants.find((r) => r._id.equals(branch.restaurantId))!;
    const cats = await CategoryModel.find({ restaurantId: restaurant._id, branchId: { $in: [null, branch._id] }, status: 'ACTIVE' }).lean();
    const catName = new Map(cats.map((c) => [String(c._id), c.name]));
    const items = (
      await MenuItemModel.find({
        restaurantId: restaurant._id,
        branchId: { $in: [null, branch._id] },
        status: 'ACTIVE',
        categoryId: { $in: cats.map((c) => c._id) },
      }).lean<(MenuItem & { _id: Types.ObjectId })[]>()
    )
      .map((i) => ({ item: i, eff: effectiveItem(i, branch._id) }))
      .filter((x) => x.eff.isAvailable);
    if (!items.length) {
      console.warn(`Skipping ${branch.name}: no available menu items`);
      return null;
    }
    const tables = await TableModel.find({ branchId: branch._id, isActive: true })
      .select('label seats')
      .lean<{ _id: Types.ObjectId; label: string; seats: number }[]>();
    const cashier: UserLean =
      (await UserModel.findOne({ role: 'RESTAURANT_ADMIN', branchIds: branch._id, status: 'ACTIVE' })
        .select('name')
        .lean<{ _id: Types.ObjectId; name: string }>()) ?? superAdmin;
    return { restaurant, branch, items, catName, tables, cashier, settings: restaurantSettings(restaurant) };
  }
}

type Setup = NonNullable<Awaited<ReturnType<typeof loadSetup>>>;

async function writeBills(setups: Setup[]) {
  // Spread the bills over the days (weekends ~30% busier), then pick times within each day.
  const tz = env.APP_TIMEZONE;
  const today = todayIn(tz);
  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i - DAYS + 1));
  const dayWeight = days.map((d) => ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()) ? 1.3 : 1) * (0.85 + rand() * 0.3));
  const totalWeight = dayWeight.reduce((a, b) => a + b, 0);
  const now = Date.now();
  const times: Date[] = [];
  days.forEach((d, i) => {
    const n = Math.round((COUNT * dayWeight[i]) / totalWeight);
    const start = zonedDayStart(d, tz).getTime();
    for (let k = 0; k < n; k++) {
      const t = start + (weighted(HOURS) * 60 + between(0, 59)) * 60_000 + between(0, 59) * 1000;
      if (t < now) times.push(new Date(t));
    }
  });
  // Rounding and skipped future times leave a small gap – top up with earlier days.
  while (times.length < COUNT) {
    const d = days[between(0, Math.max(0, days.length - 2))];
    times.push(new Date(zonedDayStart(d, tz).getTime() + (weighted(HOURS) * 60 + between(0, 59)) * 60_000));
  }
  while (times.length > COUNT) times.splice(Math.floor(rand() * times.length), 1);
  times.sort((a, b) => a.getTime() - b.getTime());

  // Continue each branch's D-numbering after any existing demo bills.
  const seq = new Map<string, number>();
  for (const s of setups) {
    const last = await TransactionModel.findOne({ branchId: s.branch._id, isDemo: true, billNumber: /^D\d+$/ })
      .sort({ billNumber: -1 })
      .select('billNumber')
      .lean<{ billNumber: string }>();
    seq.set(String(s.branch._id), last ? Number(last.billNumber.slice(1)) : 0);
  }
  const docs = times.map((finalizedAt) => {
    const s = pick(setups);
    const key = String(s.branch._id);
    seq.set(key, (seq.get(key) ?? 0) + 1);
    const lineCount = weighted([
      [1, 25],
      [2, 35],
      [3, 25],
      [4, 10],
      [5, 5],
    ] as const);
    const chosen = new Map<string, (typeof s.items)[number]>();
    while (chosen.size < Math.min(lineCount, s.items.length)) {
      const x = pick(s.items);
      chosen.set(String(x.item._id), x);
    }
    const lines = [...chosen.values()].map((x) => ({
      x,
      unitPrice: x.eff.price,
      quantity: weighted([
        [1, 60],
        [2, 30],
        [3, 10],
      ] as const),
      taxable: x.item.taxable,
      taxRateBps: x.item.taxRateBps ?? null,
      extraTaxes: (x.item.extraTaxes ?? []).map((t) => ({ name: t.name, rateBps: t.rateBps })),
    }));
    const totals = calculateBill(lines, s.settings, null);
    const atTable = s.tables.length > 0 && rand() < 0.6;
    const table = atTable ? pick(s.tables) : null;
    const customer = !atTable || rand() < 0.5 ? `${pick(FIRST)} ${pick(LAST)}` : '';
    const status = weighted([
      ['COMPLETED', 990],
      ['VOIDED', 6],
      ['REFUNDED', 4],
    ] as const);
    const id = new Types.ObjectId();
    return {
      _id: id,
      billNumber: `D${String(seq.get(key)).padStart(5, '0')}`,
      restaurantId: s.restaurant._id,
      branchId: s.branch._id,
      tableId: table?._id ?? null,
      tableLabel: table?.label ?? '',
      type: atTable ? 'TABLE' : 'COUNTER',
      groupName: atTable ? 'Group 1' : '',
      guestCount: atTable ? between(1, Math.min(table!.seats, 4)) : 0,
      groupTag: atTable ? pick(TAGS) : '',
      customerName: customer,
      restaurantSnapshot: {
        name: s.restaurant.name,
        address: s.restaurant.address ?? '',
        phone: s.restaurant.phone ?? '',
        gstin: s.restaurant.gstin ?? '',
        receiptFooter: s.settings.receiptFooter,
      },
      branchSnapshot: { name: s.branch.name, code: s.branch.code, address: s.branch.address ?? '', phone: s.branch.phone ?? '' },
      items: lines.map((l, i) => ({
        menuItemId: l.x.item._id,
        name: l.x.item.name,
        categoryName: s.catName.get(String(l.x.item.categoryId)) ?? '',
        imageUrl: l.x.eff.imageUrl,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        taxable: l.taxable,
        taxRateBps: l.taxRateBps,
        extraTaxes: l.extraTaxes,
        lineTotal: totals.lineTotals[i],
      })),
      subtotal: totals.subtotal,
      discount: null,
      taxes: totals.taxes,
      taxTotal: totals.taxTotal,
      grandTotal: totals.grandTotal,
      pricesIncludeTax: s.settings.pricesIncludeTax,
      paymentMethod: weighted(PAYMENTS),
      paymentStatus: status === 'REFUNDED' ? 'REFUNDED' : 'PAID',
      status,
      statusChange:
        status === 'COMPLETED'
          ? null
          : {
              at: new Date(finalizedAt.getTime() + 20 * 60_000),
              by: s.cashier?._id,
              byName: s.cashier?.name ?? 'Admin',
              reason: status === 'VOIDED' ? 'Billed by mistake' : 'Customer complaint',
            },
      sourceDraftId: new Types.ObjectId(),
      idempotencyKey: `demo_${id}`,
      createdBy: s.cashier?._id,
      createdByName: s.cashier?.name ?? 'Admin',
      finalizedAt,
      isDemo: true,
    };
  });

  const BATCH = 1000;
  for (let i = 0; i < docs.length; i += BATCH) {
    await TransactionModel.insertMany(docs.slice(i, i + BATCH), { ordered: false });
    process.stdout.write(`\r  inserted ${Math.min(i + BATCH, docs.length)} / ${docs.length}`);
  }
  process.stdout.write('\n');
  const sales = docs.filter((d) => d.status === 'COMPLETED').reduce((a, d) => a + d.grandTotal, 0);
  await audit(null, {
    action: 'DEMO_BILLS_CREATED',
    entityType: 'Transaction',
    entityId: 'demo',
    summary: `Created ${docs.length} demo bills over ${DAYS} days`,
  });
  console.log(`✔ Created ${docs.length} demo bills (D-numbers) for ${setups.map((s) => s.branch.name).join(', ')} – ${days[0]} to ${today}`);
  console.log(`  Completed sales ₹${Math.round(sales / 100).toLocaleString('en-IN')}. Remove anytime: npm run seed:bills -- --remove`);
}

connectDatabase()
  .then(() => (REMOVE ? remove() : generate()))
  .catch((err) => {
    console.error(`✖ ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
