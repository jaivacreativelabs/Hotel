import type { Request, Response } from 'express';
import {
  availabilitySchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  menuItemCreateSchema,
  menuItemUpdateSchema,
  reorderSchema,
  statusSchema,
} from '@rb/shared';
import { currentUser } from '../middleware/auth.js';
import { getScope } from '../middleware/scope.js';
import * as menu from '../services/menu.service.js';
import { parse } from '../utils/validate.js';

const id = (req: Request) => String(req.params.id);

export const listCategories = async (req: Request, res: Response) => {
  res.json({ data: await menu.listCategories(getScope(req), req.query.includeInactive === 'true') });
};
export const createCategory = async (req: Request, res: Response) => {
  res.status(201).json({ data: await menu.createCategory(currentUser(req), getScope(req), parse(categoryCreateSchema, req.body)) });
};
export const updateCategory = async (req: Request, res: Response) => {
  res.json({ data: await menu.updateCategory(currentUser(req), getScope(req), id(req), parse(categoryUpdateSchema, req.body)) });
};
export const setCategoryStatus = async (req: Request, res: Response) => {
  const { status } = parse(statusSchema, req.body);
  res.json({ data: await menu.setCategoryStatus(currentUser(req), getScope(req), id(req), status) });
};
export const reorderCategories = async (req: Request, res: Response) => {
  const { ids } = parse(reorderSchema, req.body);
  res.json({ data: await menu.reorderCategories(getScope(req), ids) });
};

export const listItems = async (req: Request, res: Response) => {
  res.json({ data: await menu.listItems(getScope(req), req.query) });
};
export const createItem = async (req: Request, res: Response) => {
  res.status(201).json({ data: await menu.createItem(currentUser(req), getScope(req), parse(menuItemCreateSchema, req.body)) });
};
export const updateItem = async (req: Request, res: Response) => {
  res.json({ data: await menu.updateItem(currentUser(req), getScope(req), id(req), parse(menuItemUpdateSchema, req.body)) });
};
export const setAvailability = async (req: Request, res: Response) => {
  const { isAvailable } = parse(availabilitySchema, req.body);
  res.json({ data: await menu.setItemAvailability(currentUser(req), getScope(req), id(req), isAvailable) });
};
export const removeOverride = async (req: Request, res: Response) => {
  res.json({ data: await menu.removeOverride(currentUser(req), getScope(req), id(req)) });
};
export const uploadImage = async (req: Request, res: Response) => {
  res.json({ data: await menu.setItemImage(currentUser(req), getScope(req), id(req), req.file) });
};
export const removeImage = async (req: Request, res: Response) => {
  res.json({ data: await menu.removeItemImage(currentUser(req), getScope(req), id(req)) });
};
export const archiveItem = async (req: Request, res: Response) => {
  res.json({ data: await menu.setItemArchived(currentUser(req), getScope(req), id(req), true) });
};
export const restoreItem = async (req: Request, res: Response) => {
  res.json({ data: await menu.setItemArchived(currentUser(req), getScope(req), id(req), false) });
};
