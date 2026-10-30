/**
 * Secure initial provisioning of a Super Admin. There is deliberately no HTTP endpoint for this.
 *
 *   npm run setup:superadmin
 *   SUPERADMIN_EMAIL=… SUPERADMIN_PASSWORD=… SUPERADMIN_NAME=… npm run setup:superadmin
 *   npm run setup:superadmin -- --reset-password   (resets an existing Super Admin's password)
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { passwordSchema } from '@rb/shared';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { UserModel } from '../models/index.js';
import { audit } from '../services/audit.service.js';
import { hashPassword } from '../services/auth.service.js';

async function ask(question: string, fallback?: string): Promise<string> {
  if (fallback) return fallback;
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function main() {
  const reset = process.argv.includes('--reset-password');
  const email = (await ask('Super Admin email: ', process.env.SUPERADMIN_EMAIL)).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Invalid email');
  const name = reset ? '' : await ask('Full name: ', process.env.SUPERADMIN_NAME);
  if (!process.env.SUPERADMIN_PASSWORD) {
    console.log('Tip: set SUPERADMIN_PASSWORD in the environment to avoid typing it in clear text.');
  }
  const password = await ask('Password (min 8 chars, letters and numbers): ', process.env.SUPERADMIN_PASSWORD);
  const check = passwordSchema.safeParse(password);
  if (!check.success) throw new Error(`Weak password: ${check.error.issues[0].message}`);

  await connectDatabase();
  const existing = await UserModel.findOne({ email });
  if (reset) {
    if (!existing || existing.role !== 'SUPER_ADMIN') throw new Error('No Super Admin with that email');
    existing.passwordHash = await hashPassword(password);
    existing.tokenVersion += 1;
    existing.status = 'ACTIVE';
    existing.set({ loginFails: 0, loginFailsSince: null, lockedUntil: null });
    await existing.save();
    await audit(null, { action: 'SUPER_ADMIN_PASSWORD_RESET', entityType: 'User', entityId: existing._id, summary: `Password reset for ${email} via CLI` });
    console.log(`✔ Password reset for ${email}`);
  } else {
    if (existing) throw new Error('A user with that email already exists (use --reset-password for a Super Admin)');
    if (!name) throw new Error('Name is required');
    const user = await UserModel.create({ name, email, passwordHash: await hashPassword(password), role: 'SUPER_ADMIN' });
    await audit(null, { action: 'SUPER_ADMIN_CREATED', entityType: 'User', entityId: user._id, summary: `Super Admin ${email} provisioned via CLI` });
    console.log(`✔ Super Admin ${email} created. Sign in at the web app.`);
  }
}

main()
  .catch((err) => {
    console.error(`✖ ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
