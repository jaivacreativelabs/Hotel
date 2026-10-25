/**
 * One-tap demo sign-in buttons on the login page.
 *
 * Credentials are never stored in the repository: they come from build-time variables
 * (client/.env.local locally, Vercel → Environment Variables when deployed). A button is shown
 * only when both its email and password are set, so removing the variables hides them.
 *
 *   VITE_DEMO_SUPERADMIN_EMAIL / VITE_DEMO_SUPERADMIN_PASSWORD
 *   VITE_DEMO_BRANCH_EMAIL     / VITE_DEMO_BRANCH_PASSWORD     / VITE_DEMO_BRANCH_LABEL (optional)
 *   VITE_DEMO_BRANCH2_EMAIL    / VITE_DEMO_BRANCH2_PASSWORD    / VITE_DEMO_BRANCH2_LABEL (optional)
 *
 * Note: whatever is set here ends up in the public web bundle – use demo accounts only.
 */
const env = import.meta.env as Record<string, string | undefined>;

export interface DemoLogin {
  kind: 'super' | 'branch';
  role: string;
  hint: string;
  email: string;
  password: string;
}

const candidates = [
  { kind: 'super', role: 'Super Admin', hint: 'All branches, reports, analytics', prefix: 'VITE_DEMO_SUPERADMIN' },
  { kind: 'branch', role: env.VITE_DEMO_BRANCH_LABEL || 'Branch Admin', hint: 'Only this branch', prefix: 'VITE_DEMO_BRANCH' },
  { kind: 'branch', role: env.VITE_DEMO_BRANCH2_LABEL || 'Branch Admin 2', hint: 'Only this branch', prefix: 'VITE_DEMO_BRANCH2' },
] as const;

export const DEMO_LOGINS: DemoLogin[] = candidates
  .map((c) => ({ kind: c.kind, role: c.role, hint: c.hint, email: env[`${c.prefix}_EMAIL`] ?? '', password: env[`${c.prefix}_PASSWORD`] ?? '' }))
  .filter((d) => d.email && d.password);

export const DEMO_LOGINS_ENABLED = DEMO_LOGINS.length > 0;
