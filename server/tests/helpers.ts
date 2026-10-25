import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { afterAll, beforeAll, inject } from 'vitest';
import { createApp } from '../src/app.js';
import { connectDatabase } from '../src/config/db.js';
import { UserModel } from '../src/models/index.js';
import { hashPassword } from '../src/services/auth.service.js';

export const app = createApp();
export const PASSWORD = 'Passw0rd!';

/** Connects this test file to its own fresh database on the shared replica set. */
export function useTestDatabase() {
  beforeAll(async () => {
    const url = new URL(inject('mongoUri'));
    url.pathname = `/rb_test_${randomUUID().slice(0, 8)}`;
    await connectDatabase(url.toString());
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
}

/** Supertest agent (keeps the session cookie) that sends the CSRF header and branch header. */
export class Client {
  readonly agent: TestAgent;
  branchId: string | null = null;

  constructor() {
    this.agent = request.agent(app);
  }

  private prep<T extends request.Test>(req: T): T {
    req.set('X-Requested-With', 'rb-client');
    if (this.branchId) req.set('X-Branch-Id', this.branchId);
    return req;
  }

  get(url: string) {
    return this.prep(this.agent.get(url));
  }
  post(url: string, body?: object) {
    return this.prep(this.agent.post(url)).send(body ?? {});
  }
  put(url: string, body?: object) {
    return this.prep(this.agent.put(url)).send(body ?? {});
  }
  patch(url: string, body?: object) {
    return this.prep(this.agent.patch(url)).send(body ?? {});
  }
  delete(url: string) {
    return this.prep(this.agent.delete(url));
  }

  async login(email: string, password = PASSWORD) {
    const res = await this.post('/api/v1/auth/login', { email, password });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    return this;
  }

  useBranch(id: string) {
    this.branchId = id;
    return this;
  }
}

export async function createSuperAdmin(email = 'super@test.local') {
  await UserModel.create({ name: 'Super Admin', email, passwordHash: await hashPassword(PASSWORD), role: 'SUPER_ADMIN' });
  return new Client().login(email);
}

export interface World {
  sa: Client;
  restaurantA: string;
  restaurantB: string;
  branchA1: string;
  branchA2: string;
  branchB1: string;
  adminA1: Client;
  adminA2: Client;
  adminB1: Client;
  categoryId: string;
  items: Record<'idly' | 'dosa' | 'vada' | 'coffee' | 'biryani' | 'juice', string>;
  tables: { t1: string; t2: string; t3: string; t4: string };
}

function ok<T = Record<string, unknown>>(res: request.Response, status = 200): T {
  if (res.status !== status) {
    throw new Error(`Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data as T;
}
export { ok };

/** Two restaurants, three branches, one admin per branch, a shared menu and four tables in A1. */
export async function buildWorld(): Promise<World> {
  const sa = await createSuperAdmin();
  const rA = ok<{ id: string }>(await sa.post('/api/v1/admin/restaurants', { name: 'Restaurant A' }), 201);
  const rB = ok<{ id: string }>(await sa.post('/api/v1/admin/restaurants', { name: 'Restaurant B' }), 201);
  const a1 = ok<{ id: string }>(await sa.post('/api/v1/admin/branches', { restaurantId: rA.id, name: 'Branch A1', code: 'A1' }), 201);
  const a2 = ok<{ id: string }>(await sa.post('/api/v1/admin/branches', { restaurantId: rA.id, name: 'Branch A2', code: 'A2' }), 201);
  const b1 = ok<{ id: string }>(await sa.post('/api/v1/admin/branches', { restaurantId: rB.id, name: 'Branch B1', code: 'B1' }), 201);

  const mkAdmin = async (email: string, branchId: string) => {
    ok(await sa.post('/api/v1/admin/users', { name: email, email, password: PASSWORD, branchIds: [branchId] }), 201);
    return (await new Client().login(email)).useBranch(branchId);
  };
  const adminA1 = await mkAdmin('a1@test.local', a1.id);
  const adminA2 = await mkAdmin('a2@test.local', a2.id);
  const adminB1 = await mkAdmin('b1@test.local', b1.id);

  const cat = ok<{ id: string }>(
    await sa.post(`/api/v1/menu/categories?restaurantId=${rA.id}`, { name: 'Main', icon: '🍛' }),
    201,
  );
  const mkItem = async (name: string, price: number) =>
    ok<{ id: string }>(await sa.post(`/api/v1/menu/items?restaurantId=${rA.id}`, { categoryId: cat.id, name, price }), 201).id;
  const items = {
    idly: await mkItem('Idly', 3000),
    dosa: await mkItem('Dosa', 5000),
    vada: await mkItem('Vada', 3500),
    coffee: await mkItem('Coffee', 2500),
    biryani: await mkItem('Biryani', 8000),
    juice: await mkItem('Fresh Juice', 5000),
  };
  const mkTable = async (label: string, seats = 4) =>
    ok<{ id: string }>(await adminA1.post('/api/v1/tables', { label, seats, shape: 'SQUARE', floor: 'Ground Floor' }), 201).id;
  const tables = { t1: await mkTable('T1'), t2: await mkTable('T2'), t3: await mkTable('T3', 2), t4: await mkTable('T4', 6) };

  return {
    sa,
    restaurantA: rA.id,
    restaurantB: rB.id,
    branchA1: a1.id,
    branchA2: a2.id,
    branchB1: b1.id,
    adminA1,
    adminA2,
    adminB1,
    categoryId: cat.id,
    items,
    tables,
  };
}

export const key = () => `key_${randomUUID().replace(/-/g, '')}`;
