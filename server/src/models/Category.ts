import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { RECORD_STATUSES } from '@rb/shared';

const categorySchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    // null → shared by every branch of the restaurant
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    name: { type: String, required: true, trim: true, maxlength: 50 },
    nameKey: { type: String, required: true },
    icon: { type: String, default: '' },
    displayOrder: { type: Number, default: 0 },
    status: { type: String, enum: RECORD_STATUSES, default: 'ACTIVE' },
  },
  { timestamps: true },
);

categorySchema.index({ restaurantId: 1, branchId: 1, nameKey: 1 }, { unique: true });

export type Category = InferSchemaType<typeof categorySchema>;
export type CategoryDoc = HydratedDocument<Category>;
export const CategoryModel = model('Category', categorySchema);
