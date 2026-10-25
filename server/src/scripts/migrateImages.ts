/**
 * Copies photos from the local upload folder into MongoDB (IMAGE_STORAGE=mongo), keeping the
 * same file names so existing menu items and bills keep working. Safe to run repeatedly.
 *
 *   npm run images:migrate
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import { MenuImageModel } from '../models/index.js';
import { detectImageType, IMAGE_NAME_PATTERN, MENU_IMAGE_DIR } from '../services/storage.service.js';

async function main() {
  const dir = path.join(env.UPLOAD_DIR, MENU_IMAGE_DIR);
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => IMAGE_NAME_PATTERN.test(f));
  if (files.length === 0) {
    console.log(`No photos found in ${dir}`);
    return;
  }
  await connectDatabase();
  let copied = 0;
  let skipped = 0;
  for (const name of files) {
    if (await MenuImageModel.exists({ _id: name })) {
      skipped += 1;
      continue;
    }
    const data = await fs.readFile(path.join(dir, name));
    const kind = detectImageType(data);
    if (!kind) {
      console.warn(`Skipping ${name}: not a valid image`);
      continue;
    }
    await MenuImageModel.create({ _id: name, contentType: kind.type, data, size: data.length });
    copied += 1;
  }
  console.log(`✔ Copied ${copied} photo(s) to MongoDB, ${skipped} already there.`);
}

main()
  .catch((err) => {
    console.error(`✖ ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
