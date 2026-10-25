import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import * as admin from '../controllers/admin.controller.js';
import * as auth from '../controllers/auth.controller.js';
import * as menu from '../controllers/menu.controller.js';
import * as ops from '../controllers/operations.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { csrfProtection } from '../middleware/csrf.js';
import { apiNotFound } from '../middleware/error.js';
import { requireBranchScope, requireMenuScope } from '../middleware/scope.js';
import { imageUpload } from '../middleware/upload.js';
import { AppError } from '../utils/errors.js';

function rateLimited(message: string) {
  return (_req: unknown, _res: unknown, next: (err: unknown) => void) => next(new AppError(429, 'RATE_LIMITED', message));
}

export function createApiRouter(): Router {
  const api = Router();

  // Clients are identified by req.ip, which Express derives from X-Forwarded-For when
  // TRUST_PROXY is set. Hosts such as Vercel also send the standard `Forwarded` header, which
  // Express ignores – that is expected, so the limiter's warning about it is turned off.
  const validate = { forwardedHeader: false } as const;

  // Only failed attempts count, so busy counters are not locked out by their own logins.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.LOGIN_RATE_LIMIT_MAX,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate,
    handler: rateLimited('Too many sign-in attempts. Try again in 15 minutes.'),
  });
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 1200,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate,
    handler: rateLimited('Too many requests. Slow down a little.'),
  });

  api.use(apiLimiter);
  api.use(csrfProtection);

  api.get('/health', (_req, res) => {
    res.json({ data: { status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' } });
  });

  // ---- Auth ----
  const authRouter = Router();
  authRouter.post('/login', loginLimiter, auth.login);
  authRouter.get('/demo-accounts', auth.demoAccounts);
  authRouter.post('/demo-login', loginLimiter, auth.demoLogin);
  authRouter.post('/logout', auth.logout);
  authRouter.get('/me', authenticate, auth.me);
  authRouter.post('/change-password', authenticate, auth.changePassword);
  api.use('/auth', authRouter);

  // ---- Super Admin ----
  const adminRouter = Router();
  adminRouter.use(authenticate, requireRole('SUPER_ADMIN'));
  adminRouter.get('/restaurants', admin.listRestaurants);
  adminRouter.post('/restaurants', admin.createRestaurant);
  adminRouter.get('/restaurants/:id', admin.getRestaurant);
  adminRouter.patch('/restaurants/:id', admin.updateRestaurant);
  adminRouter.patch('/restaurants/:id/status', admin.setRestaurantStatus);
  adminRouter.patch('/restaurants/:id/settings', admin.updateRestaurantSettings);
  adminRouter.get('/branches', admin.listBranches);
  adminRouter.post('/branches', admin.createBranch);
  adminRouter.patch('/branches/:id', admin.updateBranch);
  adminRouter.patch('/branches/:id/status', admin.setBranchStatus);
  adminRouter.get('/users', admin.listUsers);
  adminRouter.post('/users', admin.createUser);
  adminRouter.patch('/users/:id', admin.updateUser);
  adminRouter.patch('/users/:id/status', admin.setUserStatus);
  adminRouter.post('/users/:id/reset-password', admin.resetUserPassword);
  adminRouter.get('/demo-accounts', admin.listDemoAccounts);
  adminRouter.patch('/demo-accounts/:id', admin.updateDemoAccount);
  adminRouter.get('/analytics/overview', admin.analyticsOverview);
  adminRouter.get('/reports/transactions.csv', admin.transactionsCsv);
  adminRouter.get('/reports/sales.csv', admin.salesCsv);
  adminRouter.get('/reports/restaurants.csv', admin.restaurantsCsv);
  adminRouter.get('/reports/branches.csv', admin.branchesCsv);
  adminRouter.get('/audit-logs', admin.auditLogs);
  api.use('/admin', adminRouter);

  // ---- Menu (both roles, scoped) ----
  const menuRouter = Router();
  menuRouter.use(authenticate, requireMenuScope);
  menuRouter.get('/categories', menu.listCategories);
  menuRouter.post('/categories', menu.createCategory);
  menuRouter.post('/categories/reorder', menu.reorderCategories);
  menuRouter.patch('/categories/:id', menu.updateCategory);
  menuRouter.patch('/categories/:id/status', menu.setCategoryStatus);
  menuRouter.get('/items', menu.listItems);
  menuRouter.post('/items', menu.createItem);
  menuRouter.patch('/items/:id', menu.updateItem);
  menuRouter.patch('/items/:id/availability', menu.setAvailability);
  menuRouter.patch('/items/:id/pin', menu.setPinned);
  menuRouter.delete('/items/:id/override', menu.removeOverride);
  menuRouter.post('/items/:id/image', imageUpload, menu.uploadImage);
  menuRouter.delete('/items/:id/image', menu.removeImage);
  menuRouter.post('/items/:id/archive', menu.archiveItem);
  menuRouter.post('/items/:id/restore', menu.restoreItem);
  api.use('/menu', menuRouter);

  // ---- Tables & open bills (branch scoped) ----
  const tablesRouter = Router();
  tablesRouter.use(authenticate, requireBranchScope);
  tablesRouter.get('/', ops.listTables);
  tablesRouter.post('/', ops.createTable);
  tablesRouter.patch('/:id', ops.updateTable);
  tablesRouter.delete('/:id', ops.deleteTable);
  api.use('/tables', tablesRouter);

  const billsRouter = Router();
  billsRouter.use(authenticate, requireBranchScope);
  billsRouter.get('/counter', ops.counterDraft);
  billsRouter.get('/', ops.tableDrafts);
  billsRouter.post('/table-groups', ops.createGroup);
  billsRouter.get('/:id', ops.getDraft);
  billsRouter.put('/:id', ops.updateDraft);
  billsRouter.post('/:id/finalize', ops.finalizeDraft);
  billsRouter.delete('/:id', ops.deleteDraft);
  api.use('/bills', billsRouter);

  // ---- Transactions (role-filtered in the service) ----
  const txRouter = Router();
  txRouter.use(authenticate);
  txRouter.get('/', ops.listTransactions);
  txRouter.get('/export.csv', ops.exportTransactions);
  txRouter.get('/:id', ops.getTransaction);
  txRouter.put('/:id', ops.editTransaction);
  txRouter.post('/:id/void', ops.voidTransaction);
  txRouter.post('/:id/refund', ops.refundTransaction);
  api.use('/transactions', txRouter);

  api.use(apiNotFound);
  return api;
}
