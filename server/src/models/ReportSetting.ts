import { model, Schema, type InferSchemaType } from 'mongoose';

/**
 * Settings and send state of the emailed daily sales report (one document, `_id: "daily"`).
 * `lastSentFor` is claimed atomically before sending, so the report goes out once per day even
 * when both a local server and Vercel Cron are running.
 */
const reportSettingSchema = new Schema(
  {
    _id: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    recipients: { type: [String], default: [] },
    lastSentFor: { type: String, default: '' }, // "YYYY-MM-DD" in APP_TIMEZONE
    lastSentAt: { type: Date, default: null },
    lastError: { type: String, default: '' },
    // The last automatic (scheduled) check and what came of it, shown on the Daily Report page.
    lastRunAt: { type: Date, default: null },
    lastRunResult: { type: String, default: '' },
  },
  { timestamps: true },
);

export type ReportSetting = InferSchemaType<typeof reportSettingSchema>;
export const ReportSettingModel = model('ReportSetting', reportSettingSchema);
