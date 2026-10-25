import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing';
process.env.MONGODB_URI = 'provided-by-global-setup';
process.env.LOGIN_RATE_LIMIT_MAX = '20';
process.env.APP_TIMEZONE = 'Asia/Kolkata';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'rb-test-uploads');
