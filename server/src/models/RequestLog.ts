import { model, Schema } from 'mongoose';

/**
 * Saves the app sent with a REQUEST_KEY_HEADER, so a retry of the same save (after the answer
 * was lost on the way back) gets that answer again instead of running a second time.
 */
const requestLogSchema = new Schema({
  /** the client's random key */
  _id: { type: String, required: true },
  /** "PATCH /api/v1/menu/items/…" – a key is only valid for the request it was made for */
  fingerprint: { type: String, required: true },
  done: { type: Boolean, default: false },
  status: { type: Number, default: null },
  contentType: { type: String, default: '' },
  body: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, expires: 24 * 3600 },
});

export const RequestLogModel = model('RequestLog', requestLogSchema);
