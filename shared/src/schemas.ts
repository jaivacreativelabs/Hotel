/**
 * Request validation schemas shared by the server (authoritative) and the client (form hints).
 * Every body schema is strict: unknown keys such as `role`, `price` on bills or `total` are
 * rejected instead of silently ignored.
 */
import { z } from 'zod';
import {
  DISCOUNT_TYPES,
  KITCHEN_STATUSES,
  LIMITS,
  PAYMENT_METHODS,
  RECORD_STATUSES,
  TABLE_SHAPES,
  TABLE_STATUSES,
  TRANSACTION_STATUSES,
} from './constants.js';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const name = (max: number) => z.string().trim().min(1, 'Required').max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const optionalEmail = z.union([z.literal(''), z.string().trim().toLowerCase().email('Invalid email')]).optional();
const optionalPhone = z
  .string()
  .trim()
  .max(20)
  .regex(/^[0-9+\-() ]*$/, 'Invalid phone number')
  .optional();

export const passwordSchema = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Must contain a letter')
  .regex(/\d/, 'Must contain a number');

export const pricePaiseSchema = z
  .number()
  .int('Price must be whole paise')
  .min(0, 'Price cannot be negative')
  .max(LIMITS.maxPricePaise, 'Price is too high');

// ---------- Auth ----------
export const loginSchema = z.strictObject({
  email: z.string().trim().toLowerCase().email('Invalid email').max(200),
  password: z.string().min(1, 'Required').max(200),
});

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

// ---------- Restaurants / branches ----------
export const statusSchema = z.strictObject({ status: z.enum(RECORD_STATUSES) });

export const restaurantCreateSchema = z.strictObject({
  name: name(100),
  phone: optionalPhone,
  email: optionalEmail,
  address: optionalText(300),
  gstin: optionalText(20),
});
export const restaurantUpdateSchema = restaurantCreateSchema.partial();

export const taxRateSchema = z.strictObject({
  name: name(30),
  rateBps: z.number().int().min(0).max(10_000),
});

export const restaurantSettingsSchema = z.strictObject({
  taxes: z.array(taxRateSchema).max(LIMITS.maxTaxes),
  pricesIncludeTax: z.boolean(),
  receiptFooter: z.string().trim().max(200),
});

const branchCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,10}$/, 'Letters and digits only, max 10');

export const branchCreateSchema = z.strictObject({
  restaurantId: objectIdSchema,
  name: name(100),
  code: branchCode,
  address: optionalText(300),
  phone: optionalPhone,
  email: optionalEmail,
  /** Kitchen Display (order tickets board) for this branch */
  kitchenDisplay: z.boolean().optional(),
});
export const branchUpdateSchema = branchCreateSchema.omit({ restaurantId: true }).partial();

export const kitchenAdvanceSchema = z.strictObject({ from: z.enum(KITCHEN_STATUSES) });
export const kitchenPrioritySchema = z.strictObject({ priority: z.boolean() });

// ---------- Users (Restaurant Admins only) ----------
// Branches are fully isolated: a Restaurant Admin manages exactly one branch. Only the
// Super Admin works across branches.
const singleBranchSchema = z
  .array(objectIdSchema)
  .min(1, 'Choose the branch this admin manages')
  .max(1, 'A Restaurant Admin can manage only one branch');

export const userCreateSchema = z.strictObject({
  name: name(100),
  email: z.string().trim().toLowerCase().email('Invalid email').max(200),
  password: passwordSchema,
  branchIds: singleBranchSchema,
});
export const userUpdateSchema = z.strictObject({
  name: name(100).optional(),
  branchIds: singleBranchSchema.optional(),
});
export const resetPasswordSchema = z.strictObject({ password: passwordSchema });

// ---------- Demo sign-in buttons (configured by the Super Admin, stored in MongoDB) ----------
export const demoAccountUpdateSchema = z.strictObject({
  enabled: z.boolean(),
  label: z.string().trim().max(40).optional(),
});
export const demoLoginSchema = z.strictObject({ userId: objectIdSchema });

export const dailyReportSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  recipients: z
    .array(z.string().trim().toLowerCase().email('Invalid email').max(200))
    .max(10, 'At most 10 email addresses')
    .refine((a) => new Set(a).size === a.length, 'Each email only once'),
});
export type DailyReportSettingsInput = z.infer<typeof dailyReportSettingsSchema>;
/** "Send now": to the saved recipients, or a one-off copy to `to` (they are not saved). */
export const dailyReportSendSchema = z.strictObject({
  to: z.array(z.string().trim().toLowerCase().email('Invalid email').max(200)).min(1).max(10).optional(),
});

// ---------- Menu ----------
export const categoryCreateSchema = z.strictObject({
  name: name(50),
  icon: z.string().trim().max(8).optional(),
});
export const categoryUpdateSchema = categoryCreateSchema.partial();
export const reorderSchema = z.strictObject({ ids: z.array(objectIdSchema).min(1).max(200) });

export const menuItemCreateSchema = z.strictObject({
  categoryId: objectIdSchema,
  name: name(80),
  description: z.string().trim().max(300).optional(),
  price: pricePaiseSchema,
  taxable: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
});
export const menuItemUpdateSchema = menuItemCreateSchema.partial();
export const availabilitySchema = z.strictObject({ isAvailable: z.boolean() });
export const pinSchema = z.strictObject({ pinned: z.boolean() });

// ---------- Tables ----------
export const tableCreateSchema = z.strictObject({
  label: z
    .string()
    .trim()
    .min(1, 'Required')
    .max(10)
    .regex(/^[A-Za-z0-9 -]+$/, 'Letters, digits, space or dash'),
  seats: z.number().int().min(1).max(LIMITS.maxSeats),
  shape: z.enum(TABLE_SHAPES),
  floor: z.string().trim().min(1).max(40),
  status: z.enum(TABLE_STATUSES).optional(),
});
export const tableUpdateSchema = tableCreateSchema.partial();

// ---------- Bills ----------
export const discountSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal(DISCOUNT_TYPES[0]), value: z.number().int().min(0).max(10_000) }),
  z.strictObject({ type: z.literal(DISCOUNT_TYPES[1]), value: pricePaiseSchema }),
]);

export const createGroupSchema = z.strictObject({
  tableId: objectIdSchema,
  guestCount: z.number().int().min(1).max(LIMITS.maxSeats),
  /** Optional name such as "Ravi family"; defaults to "Group N". */
  groupName: z.string().trim().max(40).optional(),
  groupTag: z.string().trim().max(30).optional(),
});

export const draftUpdateSchema = z.strictObject({
  version: z.number().int().min(0),
  items: z
    .array(
      z.strictObject({
        menuItemId: objectIdSchema,
        quantity: z.number().int().min(1).max(LIMITS.maxQuantity),
      }),
    )
    .max(LIMITS.maxBillLines)
    .refine((items) => new Set(items.map((i) => i.menuItemId)).size === items.length, {
      message: 'Duplicate items',
    }),
  customerName: z.string().trim().max(80).optional(),
  discount: discountSchema.nullable().optional(),
  guestCount: z.number().int().min(1).max(LIMITS.maxSeats).optional(),
  groupTag: z.string().trim().max(30).optional(),
});

export const finalizeSchema = z.strictObject({
  version: z.number().int().min(0),
  paymentMethod: z.enum(PAYMENT_METHODS),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/, 'Invalid idempotency key'),
});

/** Correcting a generated bill within the edit window. Prices always come from the server. */
export const transactionEditSchema = z.strictObject({
  /** editCount the client last saw – a stale value returns 409 instead of overwriting */
  editCount: z.number().int().min(0),
  items: z
    .array(
      z.strictObject({
        menuItemId: objectIdSchema,
        quantity: z.number().int().min(1).max(LIMITS.maxQuantity),
      }),
    )
    .min(1, 'A bill needs at least one item – void it instead')
    .max(LIMITS.maxBillLines)
    .refine((items) => new Set(items.map((i) => i.menuItemId)).size === items.length, { message: 'Duplicate items' }),
  paymentMethod: z.enum(PAYMENT_METHODS),
  customerName: z.string().trim().max(80).optional(),
  discount: discountSchema.nullable().optional(),
  reason: z.string().trim().max(200).optional(),
});

export const transactionStatusChangeSchema = z.strictObject({
  reason: z.string().trim().min(3, 'Give a reason').max(200),
});

// ---------- Queries ----------
const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(LIMITS.maxPageSize).default(20),
};

export const transactionQuerySchema = z.object({
  ...pageQuery,
  q: z.string().trim().max(50).optional(),
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  status: z.enum(TRANSACTION_STATUSES).optional(),
  restaurantId: objectIdSchema.optional(),
  branchId: objectIdSchema.optional(),
});

export const analyticsQuerySchema = z.object({
  from: dateStringSchema,
  to: dateStringSchema,
  restaurantId: objectIdSchema.optional(),
  branchId: objectIdSchema.optional(),
});

export const salesReportQuerySchema = analyticsQuerySchema.extend({
  granularity: z.enum(['day', 'month']).default('day'),
});

export const auditQuerySchema = z.object({
  ...pageQuery,
  restaurantId: objectIdSchema.optional(),
  action: z.string().trim().max(60).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RestaurantCreateInput = z.infer<typeof restaurantCreateSchema>;
export type RestaurantSettingsInput = z.infer<typeof restaurantSettingsSchema>;
export type BranchCreateInput = z.infer<typeof branchCreateSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export type MenuItemCreateInput = z.infer<typeof menuItemCreateSchema>;
export type MenuItemUpdateInput = z.infer<typeof menuItemUpdateSchema>;
export type TableCreateInput = z.infer<typeof tableCreateSchema>;
export type DraftUpdateInput = z.infer<typeof draftUpdateSchema>;
export type FinalizeInput = z.infer<typeof finalizeSchema>;
export type TransactionEditInput = z.infer<typeof transactionEditSchema>;
export type TransactionQuery = z.infer<typeof transactionQuerySchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
