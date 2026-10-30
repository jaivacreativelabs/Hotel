import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { ExpenseModel } from '../src/models/index.js';
import { todayIn } from '../src/utils/dates.js';
import { app, buildWorld, useTestDatabase, type World } from './helpers.js';

useTestDatabase();

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});

const expense = (note: string) => ({ date: todayIn(env.APP_TIMEZONE), category: 'SNACKS', amount: 5000, paymentMethod: 'CASH', note });
const KEY = 'idempotency-key';

describe('a save sent again with the same request key', () => {
  it('is saved once and gets the first answer back', async () => {
    const key = 'rq_0123456789abcdef0123';
    const first = await w.adminA1.post('/api/v1/expenses', expense('once')).set(KEY, key);
    const again = await w.adminA1.post('/api/v1/expenses', expense('once')).set(KEY, key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);
    expect(await ExpenseModel.countDocuments({ note: 'once' })).toBe(1);
  });

  it('runs again when the first try failed on the server, and keeps a rejected answer', async () => {
    const key = 'rq_bad_request_key_0001';
    const bad = await w.adminA1.post('/api/v1/expenses', { ...expense('x'), amount: -1 }).set(KEY, key);
    expect(bad.status).toBe(400);
    expect((await w.adminA1.post('/api/v1/expenses', { ...expense('x'), amount: -1 }).set(KEY, key)).status).toBe(400);
  });

  it('cannot be used for another request', async () => {
    const key = 'rq_other_request_key_01';
    expect((await w.adminA1.post('/api/v1/expenses', expense('a')).set(KEY, key)).status).toBe(201);
    expect((await w.adminA1.patch('/api/v1/menu/items/000000000000000000000000', { name: 'x' }).set(KEY, key)).status).toBe(422);
  });

  it('never hands the stored answer to another session or to no session', async () => {
    const key = 'rq_private_answer_key_01';
    expect((await w.adminA1.post('/api/v1/expenses', expense('mine')).set(KEY, key)).status).toBe(201);
    const stranger = await w.adminA2.post('/api/v1/expenses', expense('mine')).set(KEY, key);
    expect(stranger.status).toBe(422);
    expect(stranger.headers['idempotent-replayed']).toBeUndefined();
    const anonymous = await request(app).post('/api/v1/expenses').set('X-Requested-With', 'rb-client').set(KEY, key).send(expense('mine'));
    expect(anonymous.status).toBe(422);
    expect(JSON.stringify(anonymous.body)).not.toContain('mine');
  });

  it('different keys are different saves; no key works as before', async () => {
    await w.adminA1.post('/api/v1/expenses', expense('twice')).set(KEY, 'rq_first_key_000000001');
    await w.adminA1.post('/api/v1/expenses', expense('twice')).set(KEY, 'rq_second_key_00000001');
    await w.adminA1.post('/api/v1/expenses', expense('twice'));
    expect(await ExpenseModel.countDocuments({ note: 'twice' })).toBe(3);
  });

  it('rejects a malformed key', async () => {
    expect((await w.adminA1.post('/api/v1/expenses', expense('m')).set(KEY, 'short')).status).toBe(400);
  });
});
