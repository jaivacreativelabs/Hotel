import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
// Same depth from src/config and dist/config → repository root.
export const repoRoot = path.resolve(here, '../../..');
export const serverRoot = path.resolve(here, '../..');

if (process.env.NODE_ENV !== 'test') {
  const envFile = path.join(repoRoot, '.env');
  // Existing environment variables win over the file.
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
}

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const isProd = process.env.NODE_ENV === 'production';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z
    .string({ error: 'MONGODB_URI is required (see README → "Getting a MongoDB URL")' })
    .min(1, 'MONGODB_URI is required (see README → "Getting a MongoDB URL")'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().positive().max(24 * 30).default(12),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  APP_TIMEZONE: z.string().default('Asia/Kolkata'),
  UPLOAD_DIR: z.string().default(path.join(serverRoot, 'uploads')),
  // mongo: photos stored in MongoDB (works on serverless hosts); local: files in UPLOAD_DIR
  IMAGE_STORAGE: z.enum(['mongo', 'local']).default('mongo'),
  COOKIE_SECURE: bool(isProd),
  SERVE_CLIENT: bool(false),
  CLIENT_DIST: z.string().default(path.join(repoRoot, 'client', 'dist')),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  // Vercel always sits behind one proxy hop, so trust it there without extra configuration.
  TRUST_PROXY: z.coerce.number().int().min(0).default(process.env.VERCEL ? 1 : 0),
  // Outgoing mail (daily report). Gmail: the account address and a Google "App password".
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  MAIL_FROM_NAME: z.string().default('Tiffin House Reports'),
  // Daily report time (HH:MM in APP_TIMEZONE) and the secret Vercel Cron sends as a Bearer token.
  DAILY_REPORT_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'DAILY_REPORT_TIME must look like 21:00')
    .default('21:00'),
  CRON_SECRET: z.string().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  console.error(`Invalid environment configuration:\n${lines.join('\n')}\nCopy .env.example to .env and fill it in.`);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  mailConfigured: Boolean(parsed.data.SMTP_USER && parsed.data.SMTP_PASS),
};

try {
  Intl.DateTimeFormat('en-US', { timeZone: env.APP_TIMEZONE });
} catch {
  console.error(`APP_TIMEZONE "${env.APP_TIMEZONE}" is not a valid IANA time zone`);
  process.exit(1);
}
