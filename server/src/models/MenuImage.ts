import { model, Schema } from 'mongoose';

/**
 * Menu photo bytes, keyed by their public file name. Kept in a collection of its own so menu
 * documents only store the URL. Used by the "mongo" image storage driver (serverless hosts
 * such as Vercel have no persistent disk).
 */
const menuImageSchema = new Schema(
  {
    _id: { type: String, required: true }, // e.g. "3f1c…e2.jpg"
    contentType: { type: String, required: true },
    data: { type: Buffer, required: true },
    size: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const MenuImageModel = model('MenuImage', menuImageSchema);
