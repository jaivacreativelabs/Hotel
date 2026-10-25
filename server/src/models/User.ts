import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { RECORD_STATUSES, ROLES } from '@rb/shared';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    passwordHash: { type: String, required: true, select: false },
    // `immutable`: a role can never be changed after the account exists.
    role: { type: String, enum: ROLES, required: true, immutable: true },
    restaurantIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Restaurant' }], default: [] },
    branchIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Branch' }], default: [] },
    status: { type: String, enum: RECORD_STATUSES, default: 'ACTIVE' },
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1, status: 1 });
userSchema.index({ branchIds: 1 });

export type User = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<User>;
export const UserModel = model('User', userSchema);
