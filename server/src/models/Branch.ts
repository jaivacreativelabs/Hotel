import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { RECORD_STATUSES } from '@rb/shared';

const branchSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    nameKey: { type: String, required: true },
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 10 },
    address: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    status: { type: String, enum: RECORD_STATUSES, default: 'ACTIVE' },
    // Orders are sent to a Kitchen Display board for this branch (Super Admin setting)
    kitchenDisplay: { type: Boolean, default: false },
  },
  { timestamps: true },
);

branchSchema.index({ restaurantId: 1, code: 1 }, { unique: true });
branchSchema.index({ restaurantId: 1, nameKey: 1 }, { unique: true });

export type Branch = InferSchemaType<typeof branchSchema>;
export type BranchDoc = HydratedDocument<Branch>;
export const BranchModel = model('Branch', branchSchema);
