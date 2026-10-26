import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { RECORD_STATUSES } from '@rb/shared';

const taxSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 30 },
    rateBps: { type: Number, required: true, min: 0, max: 10_000 },
  },
  { _id: false },
);

const restaurantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    nameKey: { type: String, required: true },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    address: { type: String, default: '' },
    gstin: { type: String, default: '' },
    // Shown at the top-left for the restaurant's branches and printed on its bills
    logoUrl: { type: String, default: null },
    status: { type: String, enum: RECORD_STATUSES, default: 'ACTIVE' },
    settings: {
      taxes: { type: [taxSchema], default: [] },
      pricesIncludeTax: { type: Boolean, default: false },
      receiptFooter: { type: String, default: 'Thank you! Visit again.' },
    },
  },
  { timestamps: true },
);

restaurantSchema.index({ nameKey: 1 }, { unique: true });

export type Restaurant = InferSchemaType<typeof restaurantSchema>;
export type RestaurantDoc = HydratedDocument<Restaurant>;
export const RestaurantModel = model('Restaurant', restaurantSchema);
