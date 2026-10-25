/**
 * One-tap demo sign-in buttons on the login page.
 *
 * Credentials are never stored in the repository: they come from build-time variables
 * (client/.env.local locally, Vercel → Environment Variables when deployed). A button is shown
 * only when both its email and password are set, so removing the variables hides them.
 *
 *   VITE_DEMO_SUPERADMIN_EMAIL / VITE_DEMO_SUPERADMIN_PASSWORD
 *   VITE_DEMO_BRANCH_EMAIL     / VITE_DEMO_BRANCH_PASSWORD
 *
 * Note: whatever is set here ends up in the public web bundle – use demo accounts only.
 */
const env = import.meta.env;

export const DEMO_LOGINS = [
  {
    role: 'Super Admin',
    hint: 'Restaurants, admins, reports, analytics',
    email: env.VITE_DEMO_SUPERADMIN_EMAIL as string | undefined,
    password: env.VITE_DEMO_SUPERADMIN_PASSWORD as string | undefined,
  },
  {
    role: 'Branch Admin',
    hint: 'New bill, tables, menu, transactions',
    email: env.VITE_DEMO_BRANCH_EMAIL as string | undefined,
    password: env.VITE_DEMO_BRANCH_PASSWORD as string | undefined,
  },
].filter((d): d is { role: string; hint: string; email: string; password: string } => Boolean(d.email && d.password));

export const DEMO_LOGINS_ENABLED = DEMO_LOGINS.length > 0;
