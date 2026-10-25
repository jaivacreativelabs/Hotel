/**
 * Image storage. The local driver writes to UPLOAD_DIR/menu with random names; swap this
 * module for an object-storage driver (S3, GCS, Cloudinary…) in production – callers only
 * use `saveImage` and the returned public URL.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { badRequest } from '../utils/errors.js';

const SIGNATURES: { ext: string; test: (b: Buffer) => boolean }[] = [
  { ext: 'jpg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: 'png',
    test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: 'webp',
    test: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
];

export const MENU_IMAGE_DIR = 'menu';

/** Detects the real file type from its bytes – the client-supplied name and MIME are ignored. */
export function detectImageType(buffer: Buffer): string | null {
  return SIGNATURES.find((s) => s.test(buffer))?.ext ?? null;
}

export async function saveImage(buffer: Buffer): Promise<string> {
  const ext = detectImageType(buffer);
  if (!ext) throw badRequest('Only JPEG, PNG or WebP images are allowed', 'INVALID_IMAGE');
  const dir = path.join(env.UPLOAD_DIR, MENU_IMAGE_DIR);
  await fs.mkdir(dir, { recursive: true });
  const fileName = `${randomUUID()}.${ext}`;
  await fs.writeFile(path.join(dir, fileName), buffer, { flag: 'wx' });
  return `/uploads/${MENU_IMAGE_DIR}/${fileName}`;
}
