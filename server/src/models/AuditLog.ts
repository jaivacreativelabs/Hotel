import { model, Schema, type InferSchemaType } from 'mongoose';
import { ROLES } from '@rb/shared';

const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: 'system' },
    actorRole: { type: String, enum: [...ROLES, 'SYSTEM'], default: 'SYSTEM' },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    summary: { type: String, default: '' },
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ restaurantId: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });

export type AuditLog = InferSchemaType<typeof auditLogSchema>;
export const AuditLogModel = model('AuditLog', auditLogSchema);
