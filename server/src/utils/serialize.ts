/** Mongo documents → API DTOs (see shared/src/types.ts). */
import type { Types } from 'mongoose';
import type {
  AuditLogDTO,
  BranchDTO,
  CategoryDTO,
  DraftDTO,
  MenuItemDTO,
  RestaurantDTO,
  TransactionDTO,
  UserDTO,
} from '@rb/shared';
import type { AuthUser } from '../middleware/auth.js';
import type { BranchLean, RestaurantLean } from '../middleware/scope.js';
import type { AuditLog, Category, Draft, MenuItem, Transaction } from '../models/index.js';

type WithId<T> = T & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date };

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const sameId = (a: Types.ObjectId | null | undefined, b: Types.ObjectId | null | undefined) =>
  a == null || b == null ? a == null && b == null : a.equals(b);

export function toUserDTO(u: AuthUser): UserDTO {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    restaurantIds: u.restaurantIds.map(String),
    branchIds: u.branchIds.map(String),
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: iso(u.createdAt) ?? '',
  };
}

export function restaurantSettings(r: RestaurantLean): RestaurantDTO['settings'] {
  return {
    taxes: (r.settings?.taxes ?? []).map((t) => ({ name: t.name, rateBps: t.rateBps })),
    pricesIncludeTax: Boolean(r.settings?.pricesIncludeTax),
    receiptFooter: r.settings?.receiptFooter ?? '',
  };
}

export function toRestaurantDTO(r: RestaurantLean & { createdAt?: Date }, branchCount?: number): RestaurantDTO {
  return {
    id: String(r._id),
    name: r.name,
    phone: r.phone ?? '',
    email: r.email ?? '',
    address: r.address ?? '',
    gstin: r.gstin ?? '',
    status: r.status,
    settings: restaurantSettings(r),
    ...(branchCount !== undefined && { branchCount }),
    createdAt: iso(r.createdAt) ?? '',
  };
}

export function toBranchDTO(b: BranchLean & { createdAt?: Date }): BranchDTO {
  return {
    id: String(b._id),
    restaurantId: String(b.restaurantId),
    name: b.name,
    code: b.code,
    address: b.address ?? '',
    phone: b.phone ?? '',
    email: b.email ?? '',
    status: b.status,
    createdAt: iso(b.createdAt) ?? '',
  };
}

export function toCategoryDTO(c: WithId<Category>, scopeBranchId: Types.ObjectId | null): CategoryDTO {
  return {
    id: String(c._id),
    restaurantId: String(c.restaurantId),
    branchId: c.branchId ? String(c.branchId) : null,
    name: c.name,
    icon: c.icon ?? '',
    displayOrder: c.displayOrder ?? 0,
    status: c.status,
    editable: sameId(c.branchId, scopeBranchId),
  };
}

/** Price/availability/photo of an item as seen from a branch (overrides applied). */
export function effectiveItem(item: WithId<MenuItem>, branchId: Types.ObjectId | null) {
  const override = branchId ? item.branchOverrides?.find((o) => o.branchId.equals(branchId)) : undefined;
  const price = override?.price ?? item.price;
  const isAvailable = override?.isAvailable ?? item.isAvailable;
  const imageUrl = override?.imageUrl ?? item.imageUrl ?? null;
  return {
    price,
    isAvailable,
    imageUrl,
    pinned: Boolean(override?.pinned),
    hasOverride: override?.price != null || override?.isAvailable != null,
    imageOverridden: override?.imageUrl != null,
  };
}

export function toMenuItemDTO(item: WithId<MenuItem>, scopeBranchId: Types.ObjectId | null): MenuItemDTO {
  const eff = effectiveItem(item, scopeBranchId);
  const owned = sameId(item.branchId, scopeBranchId);
  return {
    id: String(item._id),
    restaurantId: String(item.restaurantId),
    branchId: item.branchId ? String(item.branchId) : null,
    categoryId: String(item.categoryId),
    name: item.name,
    description: item.description ?? '',
    imageUrl: eff.imageUrl,
    imageOverridden: eff.imageOverridden,
    pinned: eff.pinned,
    price: eff.price,
    basePrice: item.price,
    taxable: item.taxable,
    isAvailable: eff.isAvailable,
    status: item.status,
    isShared: !item.branchId && scopeBranchId !== null,
    hasOverride: eff.hasOverride,
    editable: owned,
  };
}

export function toDraftDTO(d: WithId<Draft>, tableLabel = ''): DraftDTO {
  return {
    id: String(d._id),
    restaurantId: String(d.restaurantId),
    branchId: String(d.branchId),
    type: d.type,
    tableId: d.tableId ? String(d.tableId) : null,
    tableLabel,
    groupName: d.groupName ?? '',
    guestCount: d.guestCount ?? 0,
    groupTag: d.groupTag ?? '',
    customerName: d.customerName ?? '',
    items: (d.items ?? []).map((i) => ({
      menuItemId: String(i.menuItemId),
      name: i.name,
      imageUrl: i.imageUrl ?? null,
      unitPrice: i.unitPrice,
      taxable: i.taxable,
      quantity: i.quantity,
      unavailable: Boolean(i.unavailable),
    })),
    discount: d.discount?.type ? { type: d.discount.type, value: d.discount.value ?? 0 } : null,
    totals: {
      subtotal: d.totals?.subtotal ?? 0,
      discountAmount: d.totals?.discountAmount ?? 0,
      taxes: (d.totals?.taxes ?? []).map((t) => ({ name: t.name ?? '', rateBps: t.rateBps ?? 0, amount: t.amount ?? 0 })),
      taxTotal: d.totals?.taxTotal ?? 0,
      grandTotal: d.totals?.grandTotal ?? 0,
    },
    status: d.status,
    version: d.version,
    transactionId: d.transactionId ? String(d.transactionId) : null,
    updatedAt: iso(d.updatedAt) ?? '',
    updatedByName: d.updatedByName ?? '',
  };
}

export function toTransactionDTO(t: WithId<Transaction>): TransactionDTO {
  const rs = t.restaurantSnapshot ?? {};
  const bs = t.branchSnapshot ?? {};
  return {
    id: String(t._id),
    billNumber: t.billNumber,
    restaurantId: String(t.restaurantId),
    branchId: String(t.branchId),
    tableId: t.tableId ? String(t.tableId) : null,
    tableLabel: t.tableLabel ?? '',
    type: t.type,
    groupName: t.groupName ?? '',
    guestCount: t.guestCount ?? 0,
    customerName: t.customerName ?? '',
    restaurantSnapshot: {
      name: rs.name ?? '',
      address: rs.address ?? '',
      phone: rs.phone ?? '',
      gstin: rs.gstin ?? '',
      receiptFooter: rs.receiptFooter ?? '',
    },
    branchSnapshot: { name: bs.name ?? '', code: bs.code ?? '', address: bs.address ?? '', phone: bs.phone ?? '' },
    items: t.items.map((i) => ({
      menuItemId: String(i.menuItemId),
      name: i.name,
      categoryName: i.categoryName ?? '',
      imageUrl: i.imageUrl ?? null,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      taxable: i.taxable,
      lineTotal: i.lineTotal,
    })),
    itemCount: t.items.reduce((a, i) => a + i.quantity, 0),
    subtotal: t.subtotal,
    discount: t.discount?.type
      ? { type: t.discount.type, value: t.discount.value ?? 0, amount: t.discount.amount ?? 0 }
      : null,
    taxes: (t.taxes ?? []).map((x) => ({ name: x.name ?? '', rateBps: x.rateBps ?? 0, amount: x.amount ?? 0 })),
    taxTotal: t.taxTotal,
    grandTotal: t.grandTotal,
    pricesIncludeTax: Boolean(t.pricesIncludeTax),
    paymentMethod: t.paymentMethod,
    paymentStatus: t.paymentStatus,
    status: t.status,
    statusChange: t.statusChange?.at
      ? { at: iso(t.statusChange.at) ?? '', byName: t.statusChange.byName ?? '', reason: t.statusChange.reason ?? '' }
      : null,
    createdByName: t.createdByName ?? '',
    finalizedAt: iso(t.finalizedAt) ?? '',
  };
}

export function toAuditLogDTO(a: WithId<AuditLog>): AuditLogDTO {
  return {
    id: String(a._id),
    actorName: a.actorName ?? '',
    actorRole: a.actorRole as AuditLogDTO['actorRole'],
    restaurantId: a.restaurantId ? String(a.restaurantId) : null,
    branchId: a.branchId ? String(a.branchId) : null,
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    summary: a.summary ?? '',
    createdAt: iso(a.createdAt) ?? '',
  };
}
