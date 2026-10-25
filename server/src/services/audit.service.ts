import type { ClientSession, Types } from 'mongoose';
import type { AuthUser } from '../middleware/auth.js';
import { AuditLogModel } from '../models/index.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: Types.ObjectId | string;
  summary: string;
  restaurantId?: Types.ObjectId | null;
  branchId?: Types.ObjectId | null;
  meta?: Record<string, unknown>;
}

export async function audit(actor: AuthUser | null, entry: AuditEntry, session?: ClientSession): Promise<void> {
  await AuditLogModel.create(
    [
      {
        actorId: actor?._id ?? null,
        actorName: actor?.name ?? 'system',
        actorRole: actor?.role ?? 'SYSTEM',
        restaurantId: entry.restaurantId ?? null,
        branchId: entry.branchId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: String(entry.entityId),
        summary: entry.summary,
        meta: entry.meta ?? null,
      },
    ],
    { session },
  );
}
