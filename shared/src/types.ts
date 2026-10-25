/** API response shapes (DTOs). Ids are strings, money is integer paise, dates are ISO strings. */
import type {
  DraftStatus,
  DraftType,
  ItemStatus,
  PaymentMethod,
  PaymentStatus,
  RecordStatus,
  Role,
  TableOccupancy,
  TableShape,
  TableStatus,
  TransactionStatus,
} from './constants.js';
import type { DiscountInput, TaxLine, TaxRate } from './money.js';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: RecordStatus;
  restaurantIds: string[];
  branchIds: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

/** Public: one button on the login page. Contains no email or password. */
export interface DemoAccountDTO {
  id: string;
  label: string;
  role: Role;
  hint: string;
}

/** Super Admin view of every account and its demo-button setting. */
export interface AdminDemoAccountDTO extends DemoAccountDTO {
  name: string;
  email: string;
  status: RecordStatus;
  demoEnabled: boolean;
  demoLabel: string;
}

export interface RestaurantSettings {
  taxes: TaxRate[];
  pricesIncludeTax: boolean;
  receiptFooter: string;
}

export interface RestaurantDTO {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  gstin: string;
  status: RecordStatus;
  settings: RestaurantSettings;
  branchCount?: number;
  createdAt: string;
}

export interface BranchDTO {
  id: string;
  restaurantId: string;
  name: string;
  code: string;
  address: string;
  phone: string;
  email: string;
  status: RecordStatus;
  createdAt: string;
}

/** A branch the current user can operate, with what the billing UI needs. */
export interface BranchContextDTO {
  id: string;
  name: string;
  code: string;
  restaurant: { id: string; name: string; settings: RestaurantSettings };
}

export interface MeDTO {
  user: UserDTO;
  branches: BranchContextDTO[];
}

export interface CategoryDTO {
  id: string;
  restaurantId: string;
  branchId: string | null;
  name: string;
  icon: string;
  displayOrder: number;
  status: RecordStatus;
  /** true when the category belongs to the caller's scope and may be edited */
  editable: boolean;
}

export interface MenuItemDTO {
  id: string;
  restaurantId: string;
  branchId: string | null;
  categoryId: string;
  name: string;
  description: string;
  /** effective photo for the requested scope (branch photo, else main-menu photo) */
  imageUrl: string | null;
  /** this branch uses its own photo for a shared item */
  imageOverridden: boolean;
  /** pinned by this branch – listed first in its menu and New Bill screen */
  pinned: boolean;
  /** effective price for the requested scope */
  price: number;
  basePrice: number;
  taxable: boolean;
  /** effective availability for the requested scope */
  isAvailable: boolean;
  status: ItemStatus;
  /** shared item viewed in a branch scope */
  isShared: boolean;
  hasOverride: boolean;
  /** true when name/category/description/image may be edited in this scope */
  editable: boolean;
}

export interface DraftItemDTO {
  menuItemId: string;
  name: string;
  imageUrl: string | null;
  unitPrice: number;
  taxable: boolean;
  quantity: number;
  /** item became unavailable after it was added – must be removed before finalising */
  unavailable: boolean;
}

export interface DraftTotalsDTO {
  subtotal: number;
  discountAmount: number;
  taxes: TaxLine[];
  taxTotal: number;
  grandTotal: number;
}

export interface DraftDTO {
  id: string;
  restaurantId: string;
  branchId: string;
  type: DraftType;
  tableId: string | null;
  tableLabel: string;
  groupName: string;
  guestCount: number;
  groupTag: string;
  customerName: string;
  items: DraftItemDTO[];
  discount: DiscountInput | null;
  totals: DraftTotalsDTO;
  status: DraftStatus;
  version: number;
  transactionId: string | null;
  updatedAt: string;
  updatedByName: string;
}

export interface TableGroupSummaryDTO {
  draftId: string;
  groupName: string;
  guestCount: number;
  groupTag: string;
  itemCount: number;
  /** number of distinct dishes on the bill */
  lineCount: number;
  grandTotal: number;
  previewItems: { name: string; imageUrl: string | null }[];
  version: number;
}

export interface TableDTO {
  id: string;
  branchId: string;
  label: string;
  seats: number;
  shape: TableShape;
  floor: string;
  status: TableStatus;
  seatsUsed: number;
  occupancy: TableOccupancy;
  groups: TableGroupSummaryDTO[];
}

export interface TablesResponseDTO {
  tables: TableDTO[];
  floors: string[];
}

export interface TransactionItemDTO {
  menuItemId: string;
  name: string;
  categoryName: string;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  taxable: boolean;
  lineTotal: number;
}

export interface TransactionDTO {
  id: string;
  billNumber: string;
  restaurantId: string;
  branchId: string;
  tableId: string | null;
  tableLabel: string;
  type: DraftType;
  groupName: string;
  guestCount: number;
  customerName: string;
  restaurantSnapshot: { name: string; address: string; phone: string; gstin: string; receiptFooter: string };
  branchSnapshot: { name: string; code: string; address: string; phone: string };
  items: TransactionItemDTO[];
  itemCount: number;
  subtotal: number;
  discount: { type: string; value: number; amount: number } | null;
  taxes: TaxLine[];
  taxTotal: number;
  grandTotal: number;
  pricesIncludeTax: boolean;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: TransactionStatus;
  statusChange: { at: string; byName: string; reason: string } | null;
  createdByName: string;
  finalizedAt: string;
}

export interface AnalyticsPoint {
  key: string;
  sales: number;
  bills: number;
}

export interface AnalyticsOverviewDTO {
  range: { from: string; to: string; timezone: string };
  summary: { totalSales: number; billCount: number; averageBill: number; taxTotal: number };
  excluded: { voidedCount: number; voidedAmount: number; refundedCount: number; refundedAmount: number };
  daily: AnalyticsPoint[];
  monthly: AnalyticsPoint[];
  byRestaurant: (AnalyticsPoint & { name: string })[];
  byBranch: (AnalyticsPoint & { name: string; restaurantName: string })[];
  byPaymentMethod: (AnalyticsPoint & { key: PaymentMethod })[];
  /** Best-selling dishes (top 25) by item sales (quantity × price, before bill-level discount/tax). */
  topItems: AnalyticsRankRow[];
  /** Item sales per category. */
  topCategories: AnalyticsRankRow[];
  /** Completed sales per hour of the day (key "00"–"23", restaurant time zone). */
  hourly: AnalyticsPoint[];
}

export interface AnalyticsRankRow {
  key: string;
  name: string;
  quantity: number;
  sales: number;
}

export interface AuditLogDTO {
  id: string;
  actorName: string;
  actorRole: Role;
  restaurantId: string | null;
  branchId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt: string;
}
