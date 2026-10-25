/**
 * Image storage. Two drivers, chosen with IMAGE_STORAGE:
 *  - "mongo" (default): bytes in the `menuimages` collection – works on serverless hosts
 *    (Vercel) and keeps photos together with the database.
 *  - "local": files in UPLOAD_DIR/menu – for single-server installs with a persistent disk.
 * Either way the menu item stores only the public URL `/uploads/menu/<random>.<ext>`.
 * To use object storage (S3, GCS…) later, add a driver here; callers only use these functions.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { MenuImageModel } from '../models/index.js';
import { badRequest } from '../utils/errors.js';

const SIGNATURES: { ext: string; type: string; test: (b: Buffer) => boolean }[] = [
  { ext: 'jpg', type: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: 'png',
    type: 'image/png',
    test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: 'webp',
    type: 'image/webp',
    test: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
];

export const MENU_IMAGE_DIR = 'menu';
/** Only names we generate are ever served – no path traversal possible. */
export const IMAGE_NAME_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

/** Detects the real file type from its bytes – the client-supplied name and MIME are ignored. */
export function detectImageType(buffer: Buffer): { ext: string; type: string } | null {
  const sig = SIGNATURES.find((s) => s.test(buffer));
  return sig ? { ext: sig.ext, type: sig.type } : null;
}

export async function saveImage(buffer: Buffer): Promise<string> {
  const kind = detectImageType(buffer);
  if (!kind) throw badRequest('Only JPEG, PNG or WebP images are allowed', 'INVALID_IMAGE');
  const fileName = `${randomUUID()}.${kind.ext}`;
  if (env.IMAGE_STORAGE === 'mongo') {
    await MenuImageModel.create({ _id: fileName, contentType: kind.type, data: buffer, size: buffer.length });
  } else {
    const dir = path.join(env.UPLOAD_DIR, MENU_IMAGE_DIR);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, fileName), buffer, { flag: 'wx' });
  }
  return `/uploads/${MENU_IMAGE_DIR}/${fileName}`;
}

/** Image bytes stored in MongoDB, or null (the caller then falls back to the disk). */
export async function loadStoredImage(fileName: string): Promise<{ contentType: string; data: Buffer } | null> {
  if (!IMAGE_NAME_PATTERN.test(fileName)) return null;
  const doc = await MenuImageModel.findById(fileName);
  return doc ? { contentType: doc.contentType, data: doc.data } : null;
}
