/**
 * Menu management. Scope rules:
 *  - Restaurant scope (Super Admin, branch = null): manages the shared menu.
 *  - Branch scope: sees shared + branch-only entries. Branch-only entries are fully editable;
 *    for shared items only price/availability can change, stored as a branch override.
 */
import type { Types } from 'mongoose';
import type { CategoryCreateInput, MenuItemCreateInput, MenuItemUpdateInput, RecordStatus, VariantsInput } from '@rb/shared';
import type { AuthUser } from '../middleware/auth.js';
import type { Scope } from '../middleware/scope.js';
import { CategoryModel, MenuItemModel, type Category, type MenuItem } from '../models/index.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { toCategoryDTO, toMenuItemDTO } from '../utils/serialize.js';
import { escapeRegex, nameKey, toObjectId } from '../utils/validate.js';
import { audit } from './audit.service.js';
import { saveImage } from './storage.service.js';

type CategoryLean = Category & { _id: Types.ObjectId };
type MenuItemLean = MenuItem & { _id: Types.ObjectId };

const branchOf = (scope: Scope) => scope.branch?._id ?? null;

/** Filter for documents visible in the scope: shared ones plus the branch's own. */
function visibleFilter(scope: Scope) {
  const branchId = branchOf(scope);
  return { restaurantId: scope.restaurant._id, branchId: branchId ? { $in: [null, branchId] } : null };
}

/** Name clash rules: same scope, shared ↔ branch, and (for shared) any branch. */
function nameClashFilter(scope: Scope, key: string) {
  const branchId = branchOf(scope);
  return {
    restaurantId: scope.restaurant._id,
    nameKey: key,
    ...(branchId ? { branchId: { $in: [null, branchId] } } : {}),
  };
}

const owns = (scope: Scope, doc: { branchId?: Types.ObjectId | null }) => {
  const b = branchOf(scope);
  return b ? Boolean(doc.branchId?.equals(b)) : !doc.branchId;
};

function auditBase(scope: Scope) {
  return { restaurantId: scope.restaurant._id, branchId: branchOf(scope) };
}

// ---------------- Categories ----------------

export async function listCategories(scope: Scope, includeInactive: boolean) {
  const cats = await CategoryModel.find({ ...visibleFilter(scope), ...(includeInactive ? {} : { status: 'ACTIVE' }) })
    .sort({ branchId: 1, displayOrder: 1, name: 1 })
    .lean<CategoryLean[]>();
  return cats.map((c) => toCategoryDTO(c, branchOf(scope)));
}

async function getVisibleCategory(scope: Scope, id: string) {
  const cat = await CategoryModel.findOne({ _id: toObjectId(id, 'category'), ...visibleFilter(scope) });
  if (!cat) throw notFound('Category');
  return cat;
}

async function getOwnedCategory(scope: Scope, id: string) {
  const cat = await getVisibleCategory(scope, id);
  if (!owns(scope, cat)) throw forbidden('Shared categories are managed from the restaurant-wide menu');
  return cat;
}

export async function createCategory(actor: AuthUser, scope: Scope, input: CategoryCreateInput) {
  const key = nameKey(input.name);
  if (await CategoryModel.exists(nameClashFilter(scope, key))) {
    throw conflict(`Category "${input.name}" already exists`, 'DUPLICATE');
  }
  const last = await CategoryModel.findOne({ restaurantId: scope.restaurant._id, branchId: branchOf(scope) })
    .sort({ displayOrder: -1 })
    .lean<CategoryLean>();
  const cat = await CategoryModel.create({
    restaurantId: scope.restaurant._id,
    branchId: branchOf(scope),
    name: input.name,
    nameKey: key,
    icon: input.icon ?? '',
    displayOrder: (last?.displayOrder ?? -1) + 1,
  });
  await audit(actor, {
    ...auditBase(scope),
    action: 'CATEGORY_CREATED',
    entityType: 'Category',
    entityId: cat._id,
    summary: `Created category "${cat.name}"`,
  });
  return toCategoryDTO(cat.toObject() as CategoryLean, branchOf(scope));
}

export async function updateCategory(actor: AuthUser, scope: Scope, id: string, input: Partial<CategoryCreateInput>) {
  const cat = await getOwnedCategory(scope, id);
  if (input.name && nameKey(input.name) !== cat.nameKey) {
    const key = nameKey(input.name);
    if (await CategoryModel.exists({ ...nameClashFilter(scope, key), _id: { $ne: cat._id } })) {
      throw conflict(`Category "${input.name}" already exists`, 'DUPLICATE');
    }
    cat.name = input.name;
    cat.nameKey = key;
  }
  if (input.icon !== undefined) cat.icon = input.icon;
  await cat.save();
  await audit(actor, {
    ...auditBase(scope),
    action: 'CATEGORY_UPDATED',
    entityType: 'Category',
    entityId: cat._id,
    summary: `Updated category "${cat.name}"`,
  });
  return toCategoryDTO(cat.toObject() as CategoryLean, branchOf(scope));
}

export async function setCategoryStatus(actor: AuthUser, scope: Scope, id: string, status: RecordStatus) {
  const cat = await getOwnedCategory(scope, id);
  cat.status = status;
  await cat.save();
  await audit(actor, {
    ...auditBase(scope),
    action: status === 'ACTIVE' ? 'CATEGORY_ACTIVATED' : 'CATEGORY_DEACTIVATED',
    entityType: 'Category',
    entityId: cat._id,
    summary: `${status === 'ACTIVE' ? 'Activated' : 'Deactivated'} category "${cat.name}"`,
  });
  return toCategoryDTO(cat.toObject() as CategoryLean, branchOf(scope));
}

export async function reorderCategories(scope: Scope, ids: string[]) {
  const objectIds = ids.map((id) => toObjectId(id, 'category'));
  const owned = await CategoryModel.countDocuments({
    _id: { $in: objectIds },
    restaurantId: scope.restaurant._id,
    branchId: branchOf(scope),
  });
  if (owned !== objectIds.length) throw forbidden('Only categories of this menu can be reordered');
  await CategoryModel.bulkWrite(
    objectIds.map((_id, i) => ({ updateOne: { filter: { _id }, update: { $set: { displayOrder: i } } } })),
  );
  return listCategories(scope, true);
}

// ---------------- Items ----------------

export async function listItems(
  scope: Scope,
  query: { categoryId?: unknown; q?: unknown; includeArchived?: unknown },
) {
  const filter: Record<string, unknown> = { ...visibleFilter(scope) };
  if (query.includeArchived !== 'true') filter.status = 'ACTIVE';
  if (query.categoryId) filter.categoryId = toObjectId(query.categoryId, 'category');
  if (typeof query.q === 'string' && query.q.trim()) {
    filter.name = { $regex: escapeRegex(query.q.trim().slice(0, 50)), $options: 'i' };
  }
  const items = await MenuItemModel.find(filter).sort({ displayOrder: 1, name: 1 }).lean<MenuItemLean[]>();
  // Pinned dishes first; Array.sort is stable, so the menu order is kept within each group.
  return items.map((i) => toMenuItemDTO(i, branchOf(scope))).sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

async function getVisibleItem(scope: Scope, id: string) {
  const item = await MenuItemModel.findOne({ _id: toObjectId(id, 'item'), ...visibleFilter(scope) });
  if (!item) throw notFound('Menu item');
  return item;
}

async function getOwnedItem(scope: Scope, id: string) {
  const item = await getVisibleItem(scope, id);
  if (!owns(scope, item)) throw forbidden('This shared item is managed from the restaurant-wide menu');
  return item;
}

async function assertCategoryUsable(scope: Scope, categoryId: string) {
  const cat = await getVisibleCategory(scope, categoryId);
  if (cat.status !== 'ACTIVE') throw badRequest('This category is inactive', 'CATEGORY_INACTIVE');
  // An item in the shared menu cannot point at a branch-only category.
  if (!branchOf(scope) && cat.branchId) throw badRequest('Choose a shared category');
  return cat;
}

async function assertItemNameFree(scope: Scope, name: string, exceptId?: Types.ObjectId) {
  const clash = await MenuItemModel.exists({
    ...nameClashFilter(scope, nameKey(name)),
    ...(exceptId && { _id: { $ne: exceptId } }),
  });
  if (clash) throw conflict(`An item named "${name}" already exists`, 'DUPLICATE');
}

export async function createItem(actor: AuthUser, scope: Scope, input: MenuItemCreateInput) {
  await assertCategoryUsable(scope, input.categoryId);
  await assertItemNameFree(scope, input.name);
  const item = await MenuItemModel.create({
    restaurantId: scope.restaurant._id,
    branchId: branchOf(scope),
    categoryId: toObjectId(input.categoryId),
    name: input.name,
    nameKey: nameKey(input.name),
    description: input.description ?? '',
    price: input.price,
    taxable: input.taxable ?? true,
    isAvailable: input.isAvailable ?? true,
  });
  await audit(actor, {
    ...auditBase(scope),
    action: 'MENU_ITEM_CREATED',
    entityType: 'MenuItem',
    entityId: item._id,
    summary: `Created item "${item.name}" at ${item.price} paise`,
  });
  return toMenuItemDTO(item.toObject() as MenuItemLean, branchOf(scope));
}

function setOverride(
  item: InstanceType<typeof MenuItemModel>,
  branchId: Types.ObjectId,
  patch: { price?: number; isAvailable?: boolean; imageUrl?: string; pinned?: boolean },
) {
  const existing = item.branchOverrides.find((o) => o.branchId.equals(branchId));
  if (existing) {
    if (patch.price !== undefined) existing.price = patch.price;
    if (patch.isAvailable !== undefined) existing.isAvailable = patch.isAvailable;
    if (patch.imageUrl !== undefined) existing.imageUrl = patch.imageUrl;
    if (patch.pinned !== undefined) existing.pinned = patch.pinned;
  } else {
    item.branchOverrides.push({
      branchId,
      price: patch.price ?? null,
      isAvailable: patch.isAvailable ?? null,
      imageUrl: patch.imageUrl ?? null,
      pinned: patch.pinned ?? null,
    });
  }
}

/** Pins a dish to the top of this branch's menu and New Bill screen (any dish the branch sees). */
export async function setItemPinned(scope: Scope, id: string, pinned: boolean) {
  const branchId = branchOf(scope);
  if (!branchId) throw badRequest('Choose a branch to pin dishes');
  const item = await getVisibleItem(scope, id);
  setOverride(item, branchId, { pinned });
  await item.save();
  return toMenuItemDTO(item.toObject() as MenuItemLean, branchId);
}

export async function updateItem(actor: AuthUser, scope: Scope, id: string, input: MenuItemUpdateInput) {
  const item = await getVisibleItem(scope, id);
  const before = { name: item.name, price: item.price, isAvailable: item.isAvailable };
  const branchId = branchOf(scope);

  if (owns(scope, item)) {
    if (input.categoryId && !item.categoryId.equals(input.categoryId)) await assertCategoryUsable(scope, input.categoryId);
    if (input.name && nameKey(input.name) !== item.nameKey) {
      await assertItemNameFree(scope, input.name, item._id);
      item.nameKey = nameKey(input.name);
    }
    item.set({ ...input, ...(input.categoryId && { categoryId: toObjectId(input.categoryId) }) });
  } else {
    const disallowed = Object.keys(input).filter((k) => k !== 'price' && k !== 'isAvailable');
    if (disallowed.length) {
      throw forbidden(`Only price and availability of shared items can be changed for a branch (${disallowed.join(', ')})`);
    }
    setOverride(item, branchId!, input);
  }
  await item.save();
  if (owns(scope, item)) await syncVariantsWithDish(item.toObject() as MenuItemLean);
  await audit(actor, {
    ...auditBase(scope),
    action: owns(scope, item) ? 'MENU_ITEM_UPDATED' : 'MENU_ITEM_OVERRIDE_SET',
    entityType: 'MenuItem',
    entityId: item._id,
    summary: `Updated item "${item.name}"`,
    meta: { before, changes: input },
  });
  return toMenuItemDTO(item.toObject() as MenuItemLean, branchId);
}

export async function setItemAvailability(actor: AuthUser, scope: Scope, id: string, isAvailable: boolean) {
  return updateItem(actor, scope, id, { isAvailable });
}

/** Drops this branch's price/availability override; a branch photo is kept. */
export async function removeOverride(actor: AuthUser, scope: Scope, id: string) {
  const branchId = branchOf(scope);
  if (!branchId) throw badRequest('Overrides exist only for branches');
  const item = await getVisibleItem(scope, id);
  const existing = item.branchOverrides.find((o) => o.branchId.equals(branchId));
  if (existing?.imageUrl || existing?.pinned) {
    existing.price = null;
    existing.isAvailable = null;
  } else {
    item.set(
      'branchOverrides',
      item.branchOverrides.filter((o) => !o.branchId.equals(branchId)),
    );
  }
  await item.save();
  await audit(actor, {
    ...auditBase(scope),
    action: 'MENU_ITEM_OVERRIDE_REMOVED',
    entityType: 'MenuItem',
    entityId: item._id,
    summary: `Reset "${item.name}" to the shared price/availability`,
  });
  return toMenuItemDTO(item.toObject() as MenuItemLean, branchId);
}

/**
 * Sets the photo. For a shared item seen from a branch, the photo is stored as that branch's
 * override, so other branches keep the main-menu photo.
 */
export async function setItemImage(actor: AuthUser, scope: Scope, id: string, file: Express.Multer.File | undefined) {
  if (!file) throw badRequest('Choose an image file', 'NO_FILE');
  const item = await getVisibleItem(scope, id);
  const branchPhoto = !owns(scope, item);
  // Old files are kept: completed bills may still reference them in their snapshots.
  const url = await saveImage(file.buffer);
  if (branchPhoto) setOverride(item, branchOf(scope)!, { imageUrl: url });
  else item.imageUrl = url;
  await item.save();
  await audit(actor, {
    ...auditBase(scope),
    action: branchPhoto ? 'MENU_ITEM_BRANCH_IMAGE_SET' : 'MENU_ITEM_IMAGE_UPDATED',
    entityType: 'MenuItem',
    entityId: item._id,
    summary: `${branchPhoto ? 'Set branch photo of' : 'Updated image of'} "${item.name}"`,
  });
  return toMenuItemDTO(item.toObject() as MenuItemLean, branchOf(scope));
}

/** Removes the photo; for a shared item in a branch this restores the main-menu photo. */
export async function removeItemImage(actor: AuthUser, scope: Scope, id: string) {
  const item = await getVisibleItem(scope, id);
  const branchPhoto = !owns(scope, item);
  if (branchPhoto) {
    const branchId = branchOf(scope)!;
    const existing = item.branchOverrides.find((o) => o.branchId.equals(branchId));
    if (existing) existing.imageUrl = null;
  } else {
    item.imageUrl = null;
  }
  await item.save();
  await audit(actor, {
    ...auditBase(scope),
    action: branchPhoto ? 'MENU_ITEM_BRANCH_IMAGE_REMOVED' : 'MENU_ITEM_IMAGE_REMOVED',
    entityType: 'MenuItem',
    entityId: item._id,
    summary: `${branchPhoto ? 'Removed branch photo of' : 'Removed image of'} "${item.name}"`,
  });
  return toMenuItemDTO(item.toObject() as MenuItemLean, branchOf(scope));
}

export async function setItemArchived(actor: AuthUser, scope: Scope, id: string, archived: boolean) {
  const item = await getOwnedItem(scope, id);
  item.status = archived ? 'ARCHIVED' : 'ACTIVE';
  await item.save();
  await audit(actor, {
    ...auditBase(scope),
    action: archived ? 'MENU_ITEM_ARCHIVED' : 'MENU_ITEM_RESTORED',
    entityType: 'MenuItem',
    entityId: item._id,
    summary: `${archived ? 'Archived' : 'Restored'} item "${item.name}"`,
  });
  return toMenuItemDTO(item.toObject() as MenuItemLean, branchOf(scope));
}

// ---------------- Variants ----------------

const variantFullName = (dish: string, variant: string) => `${dish} (${variant})`;

/** Variants follow their dish's name, category and tax setting. */
async function syncVariantsWithDish(dish: MenuItemLean) {
  const variants = await MenuItemModel.find({ parentId: dish._id })
    .select('variantName status')
    .lean<{ _id: Types.ObjectId; variantName: string; status: string }[]>();
  if (!variants.length) return;
  try {
    await MenuItemModel.bulkWrite(
      variants.map((v) => {
        const name = variantFullName(dish.name, v.variantName);
        // Removed variants keep a unique key so they never block a live name.
        const key = v.status === 'ACTIVE' ? nameKey(name) : `${nameKey(name)}#${String(v._id)}`;
        return {
          updateOne: {
            filter: { _id: v._id },
            update: { $set: { name, nameKey: key, categoryId: dish.categoryId, taxable: dish.taxable } },
          },
        };
      }),
    );
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict('Another dish already has the name one of these variants would get. Rename it first.', 'DUPLICATE');
    throw err;
  }
}

/**
 * Saves a dish's variants. In the dish's own menu the list is replaced (added, renamed,
 * re-priced, removed); a branch looking at a shared dish only sets its own price and
 * availability for the existing variants.
 */
export async function setItemVariants(actor: AuthUser, scope: Scope, id: string, input: VariantsInput) {
  const dish = await getVisibleItem(scope, id);
  if (dish.parentId) throw badRequest('A variant cannot have variants of its own');
  const existing = await MenuItemModel.find({ parentId: dish._id });
  const byId = new Map(existing.map((v) => [String(v._id), v]));
  for (const row of input.variants) {
    if (row.id && !byId.has(row.id)) throw badRequest(`“${row.name}” is not a variant of ${dish.name}`);
  }

  if (!owns(scope, dish)) {
    const branchId = branchOf(scope)!;
    const active = existing.filter((v) => v.status === 'ACTIVE');
    if (input.variants.some((r) => !r.id) || input.variants.length !== active.length) {
      throw forbidden('Variants of shared food are added or removed from the main menu. Here you can change their price and availability.');
    }
    for (const row of input.variants) {
      const v = byId.get(row.id!)!;
      setOverride(v, branchId, { price: row.price, ...(row.isAvailable !== undefined && { isAvailable: row.isAvailable }) });
      await v.save();
    }
  } else {
    const keep = new Set(input.variants.filter((r) => r.id).map((r) => r.id!));
    try {
      for (const v of existing) {
        if (!keep.has(String(v._id)) && v.status === 'ACTIVE') {
          v.status = 'ARCHIVED';
          // Frees the name, so a removed variant can be added again later.
          v.nameKey = `${v.nameKey}#${String(v._id)}`;
          await v.save();
        }
      }
      for (const row of input.variants) {
        const name = variantFullName(dish.name, row.name);
        const fields = { variantName: row.name, name, nameKey: nameKey(name), price: row.price, status: 'ACTIVE' as const };
        if (row.id) {
          const v = byId.get(row.id)!;
          v.set({ ...fields, ...(row.isAvailable !== undefined && { isAvailable: row.isAvailable }) });
          await v.save();
        } else {
          await MenuItemModel.create({
            ...fields,
            restaurantId: dish.restaurantId,
            branchId: dish.branchId,
            categoryId: dish.categoryId,
            taxable: dish.taxable,
            isAvailable: row.isAvailable ?? true,
            parentId: dish._id,
          });
        }
      }
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw conflict('A dish with one of these names already exists. Use another variant name.', 'DUPLICATE');
      throw err;
    }
    // The dish shows its lowest price ("from ₹…") in lists and reports.
    if (input.variants.length) {
      dish.price = Math.min(...input.variants.map((r) => r.price));
      await dish.save();
    }
  }

  await audit(actor, {
    ...auditBase(scope),
    action: owns(scope, dish) ? 'MENU_ITEM_VARIANTS_SET' : 'MENU_ITEM_VARIANT_OVERRIDES_SET',
    entityType: 'MenuItem',
    entityId: dish._id,
    summary: `Variants of "${dish.name}": ${input.variants.map((r) => `${r.name} ${r.price} paise`).join(', ') || 'none'}`,
  });
  const variants = await MenuItemModel.find({ parentId: dish._id, status: 'ACTIVE' }).sort({ price: 1 }).lean<MenuItemLean[]>();
  return variants.map((v) => toMenuItemDTO(v, branchOf(scope)));
}
