/**
 * Optional demo data for local evaluation: one restaurant with two branches, a menu, tables
 * and a Restaurant Admin. It creates no sales – analytics only ever show real bills.
 *
 *   npm run seed:demo
 */
import { randomBytes } from 'node:crypto';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import { BranchModel, CategoryModel, MenuItemModel, RestaurantModel, TableModel, UserModel } from '../models/index.js';
import { hashPassword } from '../services/auth.service.js';
import { nameKey } from '../utils/validate.js';

const CATEGORIES: [string, string][] = [
  ['Breakfast', '🍳'],
  ['Lunch', '🍛'],
  ['Tiffin', '🍱'],
  ['Snacks', '🍟'],
  ['Beverages', '🥤'],
  ['Desserts', '🍰'],
];

const ITEMS: [string, string, number, string][] = [
  ['Idly', 'Breakfast', 30, 'Soft steamed rice cakes with sambar and chutney'],
  ['Dosa', 'Breakfast', 50, 'Crispy rice crepe'],
  ['Vada', 'Breakfast', 35, 'Crunchy lentil doughnut'],
  ['Pongal', 'Breakfast', 40, 'Rice and moong dal with pepper and ghee'],
  ['Poori', 'Tiffin', 40, 'Puffed wheat bread with potato masala'],
  ['Chapati', 'Tiffin', 35, 'Whole wheat flatbread'],
  ['Parotta', 'Tiffin', 45, 'Layered flaky flatbread'],
  ['Masala Dosa', 'Tiffin', 60, 'Dosa with spiced potato filling'],
  ['Curd Rice', 'Lunch', 40, 'Rice with fresh curd and tempering'],
  ['Lemon Rice', 'Lunch', 40, 'Tangy rice with peanuts'],
  ['Tomato Rice', 'Lunch', 40, 'Spiced tomato rice'],
  ['Veg Biryani', 'Lunch', 80, 'Fragrant vegetable biryani'],
  ['Fried Rice', 'Lunch', 70, 'Indo-Chinese vegetable fried rice'],
  ['Noodles', 'Snacks', 70, 'Vegetable hakka noodles'],
  ['Masala Tea', 'Beverages', 20, 'Spiced milk tea'],
  ['Filter Coffee', 'Beverages', 25, 'South Indian filter coffee'],
  ['Fresh Juice', 'Beverages', 50, 'Seasonal fresh fruit juice'],
  ['Gulab Jamun', 'Desserts', 40, 'Two pieces in sugar syrup'],
];

// label, seats, shape, floor, status – mirrors the reference images
const TABLES: [string, number, 'SQUARE' | 'ROUND', string, 'AVAILABLE' | 'RESERVED'][] = [
  ['T01', 4, 'SQUARE', 'Ground Floor', 'AVAILABLE'],
  ['T02', 4, 'SQUARE', 'Ground Floor', 'AVAILABLE'],
  ['T03', 6, 'ROUND', 'Ground Floor', 'AVAILABLE'],
  ['T04', 4, 'SQUARE', 'Ground Floor', 'AVAILABLE'],
  ['T05', 6, 'ROUND', 'Ground Floor', 'AVAILABLE'],
  ['T06', 4, 'SQUARE', 'Ground Floor', 'RESERVED'],
  ['T07', 4, 'SQUARE', 'Ground Floor', 'AVAILABLE'],
  ['T08', 2, 'SQUARE', 'Ground Floor', 'AVAILABLE'],
  ['T09', 4, 'SQUARE', 'Ground Floor', 'AVAILABLE'],
  ['T10', 6, 'ROUND', 'Ground Floor', 'AVAILABLE'],
  ['T11', 4, 'SQUARE', 'Ground Floor', 'AVAILABLE'],
  ['T12', 4, 'SQUARE', 'Ground Floor', 'RESERVED'],
  ['T13', 4, 'SQUARE', 'First Floor', 'AVAILABLE'],
  ['T14', 2, 'ROUND', 'First Floor', 'AVAILABLE'],
];

async function main() {
  if (env.isProd) throw new Error('Refusing to seed demo data in production');
  await connectDatabase();

  const restaurantName = 'Idly Tiffin House';
  if (await RestaurantModel.exists({ nameKey: nameKey(restaurantName) })) {
    console.log(`"${restaurantName}" already exists – nothing to do.`);
    return;
  }
  const restaurant = await RestaurantModel.create({
    name: restaurantName,
    nameKey: nameKey(restaurantName),
    phone: '+91 98765 43210',
    address: 'Chennai, Tamil Nadu',
    settings: { taxes: [], pricesIncludeTax: false, receiptFooter: 'Fresh starts. Good days. Visit again!' },
  });
  const branches = await BranchModel.create([
    { restaurantId: restaurant._id, name: 'Anna Nagar', nameKey: 'anna nagar', code: 'AN', address: 'Anna Nagar, Chennai' },
    { restaurantId: restaurant._id, name: 'T. Nagar', nameKey: 't. nagar', code: 'TN', address: 'T. Nagar, Chennai' },
  ]);

  const cats = await CategoryModel.create(
    CATEGORIES.map(([name, icon], i) => ({
      restaurantId: restaurant._id,
      branchId: null,
      name,
      nameKey: nameKey(name),
      icon,
      displayOrder: i,
    })),
  );
  const catId = new Map(cats.map((c) => [c.name, c._id]));
  await MenuItemModel.create(
    ITEMS.map(([name, cat, rupees, description], i) => ({
      restaurantId: restaurant._id,
      branchId: null,
      categoryId: catId.get(cat),
      name,
      nameKey: nameKey(name),
      description,
      price: rupees * 100,
      displayOrder: i,
    })),
  );
  for (const branch of branches) {
    await TableModel.create(
      TABLES.map(([label, seats, shape, floor, status]) => ({
        restaurantId: restaurant._id,
        branchId: branch._id,
        label,
        labelKey: nameKey(label),
        seats,
        shape,
        floor,
        status,
      })),
    );
  }

  // One Restaurant Admin per branch – branches are fully isolated.
  const admins = [
    { branch: branches[0], name: 'Anna Nagar Admin', email: 'admin@tiffinhouse.local', password: process.env.DEMO_ADMIN_PASSWORD },
    { branch: branches[1], name: 'T. Nagar Admin', email: 'tnagar@tiffinhouse.local', password: process.env.DEMO_ADMIN2_PASSWORD },
  ];
  for (const a of admins) {
    if (await UserModel.exists({ email: a.email })) continue;
    const password = a.password || `Demo-${randomBytes(4).toString('hex')}1`;
    await UserModel.create({
      name: a.name,
      email: a.email,
      passwordHash: await hashPassword(password),
      role: 'RESTAURANT_ADMIN',
      restaurantIds: [restaurant._id],
      branchIds: [a.branch._id],
    });
    console.log(`✔ ${a.name}: ${a.email} / ${password}  (change it after signing in)`);
  }
  console.log(`✔ Seeded "${restaurantName}" with ${branches.length} branches, ${ITEMS.length} items and ${TABLES.length} tables per branch.`);
}

main()
  .catch((err) => {
    console.error(`✖ ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
