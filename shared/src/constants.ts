export const ROLES = ['SUPER_ADMIN', 'RESTAURANT_ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const RECORD_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const ITEM_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const TRANSACTION_STATUSES = ['COMPLETED', 'VOIDED', 'REFUNDED'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const PAYMENT_STATUSES = ['PAID', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const DRAFT_STATUSES = ['ACTIVE', 'FINALIZED', 'DELETED'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const DRAFT_TYPES = ['TABLE', 'COUNTER'] as const;
export type DraftType = (typeof DRAFT_TYPES)[number];

export const TABLE_SHAPES = ['SQUARE', 'ROUND'] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

/** Status a user can set on a table. Occupancy is derived from active drafts. */
export const TABLE_STATUSES = ['AVAILABLE', 'RESERVED'] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

export const TABLE_OCCUPANCY = ['AVAILABLE', 'PARTIAL', 'FULL', 'RESERVED'] as const;
export type TableOccupancy = (typeof TABLE_OCCUPANCY)[number];

export const DISCOUNT_TYPES = ['PERCENT', 'FLAT'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const LIMITS = {
  maxPricePaise: 10_000_000, // ₹1,00,000 per item
  maxQuantity: 999,
  maxBillLines: 200,
  maxSeats: 30,
  maxTaxes: 5,
  maxPageSize: 100,
  maxImageBytes: 2 * 1024 * 1024,
} as const;

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'rb-client';
export const BRANCH_HEADER = 'x-branch-id';
