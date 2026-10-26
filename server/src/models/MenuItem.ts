import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { ITEM_STATUSES } from '@rb/shared';

const overrideSchema = new Schema(
  {
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    price: { type: Number, default: null },
    isAvailable: { type: Boolean, default: null },
    imageUrl: { type: String, default: null },
    // Pinned dishes are listed first in this branch's menu and New Bill screen.
    pinned: { type: Boolean, default: null },
    // A main-menu variant this branch removed from its own menu.
    hidden: { type: Boolean, default: null },
  },
  { _id: false },
);

const menuItemSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    // null → shared item; otherwise the item exists only in that branch
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    nameKey: { type: String, required: true },
    description: { type: String, default: '', maxlength: 300 },
    imageUrl: { type: String, default: null },
    price: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: 'price must be integer paise' },
    },
    taxable: { type: Boolean, default: true },
    isAvailable: { type: Boolean, default: true },
    status: { type: String, enum: ITEM_STATUSES, default: 'ACTIVE' },
    branchOverrides: { type: [overrideSchema], default: [] },
    displayOrder: { type: Number, default: 0 },
    // A variant (size / type, e.g. "Masala" of "Dosa") is its own orderable item pointing at the
    // dish it belongs to; its name is "<dish> (<variant>)". Dishes with variants are not ordered
    // themselves.
    parentId: { type: Schema.Types.ObjectId, ref: 'MenuItem', default: null },
    variantName: { type: String, default: '', maxlength: 30 },
    // How much a variant is, e.g. "2 pcs" or "250 ml" (part of its name on bills)
    variantQty: { type: String, default: '', maxlength: 20 },
  },
  { timestamps: true },
);

menuItemSchema.index({ restaurantId: 1, branchId: 1, nameKey: 1 }, { unique: true });
menuItemSchema.index({ restaurantId: 1, categoryId: 1 });
menuItemSchema.index({ parentId: 1 });

export type MenuItem = InferSchemaType<typeof menuItemSchema>;
export type MenuItemDoc = HydratedDocument<MenuItem>;
export const MenuItemModel = model('MenuItem', menuItemSchema);
