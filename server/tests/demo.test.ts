import { beforeAll, describe, expect, it } from 'vitest';
import { AuditLogModel, UserModel } from '../src/models/index.js';
import { buildWorld, Client, ok, useTestDatabase, type World } from './helpers.js';

useTestDatabase();

let w: World;
let a1Id: string;
let superId: string;
beforeAll(async () => {
  w = await buildWorld();
  a1Id = String((await UserModel.findOne({ email: 'a1@test.local' }))!._id);
  superId = String((await UserModel.findOne({ role: 'SUPER_ADMIN' }))!._id);
});

describe('demo login buttons (stored in MongoDB)', () => {
  it('shows nothing until the Super Admin enables an account', async () => {
    expect(ok<unknown[]>(await new Client().get('/api/v1/auth/demo-accounts'))).toEqual([]);
    const res = await new Client().post('/api/v1/auth/demo-login', { userId: a1Id });
    expect(res.status).toBe(403);
  });

  it('only the Super Admin can change demo settings', async () => {
    expect((await w.adminA1.get('/api/v1/admin/demo-accounts')).status).toBe(403);
    expect((await w.adminA1.patch(`/api/v1/admin/demo-accounts/${a1Id}`, { enabled: true })).status).toBe(403);
  });

  it('lists enabled accounts without any email or password and signs in with one tap', async () => {
    ok(await w.sa.patch(`/api/v1/admin/demo-accounts/${a1Id}`, { enabled: true, label: 'Branch A1 Admin' }));
    ok(await w.sa.patch(`/api/v1/admin/demo-accounts/${superId}`, { enabled: true }));
    const list = ok<Record<string, unknown>[]>(await new Client().get('/api/v1/auth/demo-accounts'));
    expect(list.map((d) => [d.label, d.role, d.hint])).toEqual([
      ['Super Admin', 'SUPER_ADMIN', 'All branches, reports, analytics'],
      ['Branch A1 Admin', 'RESTAURANT_ADMIN', 'Only Branch A1'],
    ]);
    for (const d of list) expect(Object.keys(d).sort()).toEqual(['hint', 'id', 'label', 'role']);

    const visitor = new Client();
    const me = ok<{ user: { email: string }; branches: { id: string }[] }>(await visitor.post('/api/v1/auth/demo-login', { userId: a1Id }));
    expect(me.user.email).toBe('a1@test.local');
    expect(me.branches.map((b) => b.id)).toEqual([w.branchA1]);
    expect((await visitor.get('/api/v1/auth/me')).status).toBe(200);
    expect(await AuditLogModel.countDocuments({ action: 'DEMO_LOGIN' })).toBe(1);
  });

  it('stops working immediately when the button is switched off or the account is deactivated', async () => {
    ok(await w.sa.patch(`/api/v1/admin/demo-accounts/${a1Id}`, { enabled: false }));
    expect((await new Client().post('/api/v1/auth/demo-login', { userId: a1Id })).status).toBe(403);
    const list = ok<{ id: string }[]>(await new Client().get('/api/v1/auth/demo-accounts'));
    expect(list.map((d) => d.id)).toEqual([superId]);

    ok(await w.sa.patch(`/api/v1/admin/demo-accounts/${a1Id}`, { enabled: true }));
    ok(await w.sa.patch(`/api/v1/admin/users/${a1Id}/status`, { status: 'INACTIVE' }));
    expect((await new Client().post('/api/v1/auth/demo-login', { userId: a1Id })).status).toBe(403);
    expect(ok<{ id: string }[]>(await new Client().get('/api/v1/auth/demo-accounts')).map((d) => d.id)).not.toContain(a1Id);
  });

  it('hides a branch admin whose branch is inactive (it would only reach a dead end)', async () => {
    ok(await w.sa.patch(`/api/v1/admin/users/${a1Id}/status`, { status: 'ACTIVE' }));
    expect(ok<{ id: string }[]>(await new Client().get('/api/v1/auth/demo-accounts')).map((d) => d.id)).toContain(a1Id);
    ok(await w.sa.patch(`/api/v1/admin/branches/${w.branchA1}/status`, { status: 'INACTIVE' }));
    expect(ok<{ id: string }[]>(await new Client().get('/api/v1/auth/demo-accounts')).map((d) => d.id)).not.toContain(a1Id);
    ok(await w.sa.patch(`/api/v1/admin/branches/${w.branchA1}/status`, { status: 'ACTIVE' }));
  });

  it('rejects bad ids and unknown fields', async () => {
    expect((await new Client().post('/api/v1/auth/demo-login', { userId: 'nope' })).status).toBe(400);
    expect((await new Client().post('/api/v1/auth/demo-login', { userId: superId, role: 'SUPER_ADMIN' })).status).toBe(400);
  });
});
