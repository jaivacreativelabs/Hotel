import multer from 'multer';
import { LIMITS } from '@rb/shared';

/** Keeps the upload in memory so its bytes can be verified before anything touches disk. */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.maxImageBytes, files: 1, fields: 5 },
}).single('image');
