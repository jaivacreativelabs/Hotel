/** Restaurant-level operations: tables, open bills and transactions. */
import type { Request, Response } from 'express';
import {
  createGroupSchema,
  draftUpdateSchema,
  finalizeSchema,
  tableCreateSchema,
  tableUpdateSchema,
  transactionQuerySchema,
  transactionStatusChangeSchema,
} from '@rb/shared';
import { env } from '../config/env.js';
import { currentUser } from '../middleware/auth.js';
import { getBranchScope } from '../middleware/scope.js';
import * as bills from '../services/bills.service.js';
import * as tables from '../services/tables.service.js';
import * as transactions from '../services/transactions.service.js';
import { todayIn } from '../utils/dates.js';
import { badRequest } from '../utils/errors.js';
import { parse } from '../utils/validate.js';

const id = (req: Request) => String(req.params.id);

// Tables
export const listTables = async (req: Request, res: Response) => {
  res.json({ data: await tables.listTables(getBranchScope(req), req.query.floor) });
};
export const createTable = async (req: Request, res: Response) => {
  res.status(201).json({ data: await tables.createTable(currentUser(req), getBranchScope(req), parse(tableCreateSchema, req.body)) });
};
export const updateTable = async (req: Request, res: Response) => {
  res.json({ data: await tables.updateTable(currentUser(req), getBranchScope(req), id(req), parse(tableUpdateSchema, req.body)) });
};
export const deleteTable = async (req: Request, res: Response) => {
  await tables.deactivateTable(currentUser(req), getBranchScope(req), id(req));
  res.status(204).end();
};

// Open bills (drafts)
export const counterDraft = async (req: Request, res: Response) => {
  res.json({ data: await bills.getCounterDraft(currentUser(req), getBranchScope(req)) });
};
export const tableDrafts = async (req: Request, res: Response) => {
  res.json({ data: await bills.listTableDrafts(getBranchScope(req), req.query.tableId) });
};
export const createGroup = async (req: Request, res: Response) => {
  res.status(201).json({ data: await bills.createTableGroup(currentUser(req), getBranchScope(req), parse(createGroupSchema, req.body)) });
};
export const getDraft = async (req: Request, res: Response) => {
  res.json({ data: await bills.getDraft(getBranchScope(req), id(req)) });
};
export const updateDraft = async (req: Request, res: Response) => {
  res.json({ data: await bills.updateDraft(currentUser(req), getBranchScope(req), id(req), parse(draftUpdateSchema, req.body)) });
};
export const finalizeDraft = async (req: Request, res: Response) => {
  const result = await bills.finalizeDraft(currentUser(req), getBranchScope(req), id(req), parse(finalizeSchema, req.body));
  res.status(result.replayed ? 200 : 201).json({ data: result });
};
export const deleteDraft = async (req: Request, res: Response) => {
  const version = Number(req.query.version);
  if (!Number.isInteger(version) || version < 0) throw badRequest('version is required');
  await bills.deleteDraft(currentUser(req), getBranchScope(req), id(req), version);
  res.status(204).end();
};

// Transactions
export const listTransactions = async (req: Request, res: Response) => {
  const result = await transactions.listTransactions(currentUser(req), parse(transactionQuerySchema, req.query));
  res.json(result);
};
export const getTransaction = async (req: Request, res: Response) => {
  res.json({ data: await transactions.getTransaction(currentUser(req), id(req)) });
};
export const exportTransactions = async (req: Request, res: Response) => {
  const csv = await transactions.exportTransactionsCsv(currentUser(req), parse(transactionQuerySchema, req.query));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="transactions-${todayIn(env.APP_TIMEZONE)}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
};
export const voidTransaction = async (req: Request, res: Response) => {
  const { reason } = parse(transactionStatusChangeSchema, req.body);
  res.json({ data: await transactions.changeTransactionStatus(currentUser(req), id(req), 'VOIDED', reason) });
};
export const refundTransaction = async (req: Request, res: Response) => {
  const { reason } = parse(transactionStatusChangeSchema, req.body);
  res.json({ data: await transactions.changeTransactionStatus(currentUser(req), id(req), 'REFUNDED', reason) });
};
