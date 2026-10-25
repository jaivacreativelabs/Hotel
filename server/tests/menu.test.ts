import { beforeAll, describe, expect, it } from 'vitest';
import { buildWorld, ok, useTestDatabase, type World } from './helpers.js';

useTestDatabase();

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});

interface Item {
  id: string;
  name: string;
  price: number;
  basePrice: number;
  isAvailable: boolean;
  isShared: boolean;
  editable: boolean;
  imageUrl: string | null;
}

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

describe('categories', () => {
  it('Restaurant Admin creates branch categories and sees shared ones', async () => {
    const c = ok<{ branchId: string; editable: boolean }>(await w.adminA1.post('/api/v1/menu/categories', { name: 'Specials' }), 201);
    expect(c.branchId).toBe(w.branchA1);
    expect(c.editable).toBe(true);
    const list = ok<{ name: string; editable: boolean }[]>(await w.adminA1.get('/api/v1/menu/categories'));
    expect(list.map((x) => x.name)).toEqual(expect.arrayContaining(['Main', 'Specials']));
    expect(list.find((x) => x.name === 'Main')?.editable).toBe(false);
    // Another branch does not see A1's category.
    const a2 = ok<{ name: string }[]>(await w.adminA2.get('/api/v1/menu/categories'));
    expect(a2.map((x) => x.name)).not.toContain('Specials');
  });

  it('rejects duplicates in the same scope and against shared names', async () => {
    expect((await w.adminA1.post('/api/v1/menu/categories', { name: 'specials' })).status).toBe(409);
    expect((await w.adminA1.post('/api/v1/menu/categories', { name: 'MAIN' })).status).toBe(409);
    // A different branch may reuse a branch-only name.
    expect((await w.adminA2.post('/api/v1/menu/categories', { name: 'Specials' })).status).toBe(201);
  });

  it('cannot rename shared categories from a branch', async () => {
    const list = ok<{ id: string; name: string }[]>(await w.adminA1.get('/api/v1/menu/categories'));
    const main = list.find((x) => x.name === 'Main')!;
    expect((await w.adminA1.patch(`/api/v1/menu/categories/${main.id}`, { name: 'Hacked' })).status).toBe(403);
  });

  it('deactivates and reorders own categories', async () => {
    const extra = ok<{ id: string }>(await w.adminA1.post('/api/v1/menu/categories', { name: 'Drinks' }), 201);
    const list = ok<{ id: string; editable: boolean }[]>(await w.adminA1.get('/api/v1/menu/categories'));
    const own = list.filter((c) => c.editable).map((c) => c.id).reverse();
    ok(await w.adminA1.post('/api/v1/menu/categories/reorder', { ids: own }));
    ok(await w.adminA1.patch(`/api/v1/menu/categories/${extra.id}/status`, { status: 'INACTIVE' }));
    const active = ok<{ id: string }[]>(await w.adminA1.get('/api/v1/menu/categories'));
    expect(active.map((c) => c.id)).not.toContain(extra.id);
    const all = ok<{ id: string }[]>(await w.adminA1.get('/api/v1/menu/categories?includeInactive=true'));
    expect(all.map((c) => c.id)).toContain(extra.id);
  });
});

describe('menu items', () => {
  it('validates required fields and prices', async () => {
    expect((await w.adminA1.post('/api/v1/menu/items', { categoryId: w.categoryId, name: '', price: 100 })).status).toBe(400);
    expect((await w.adminA1.post('/api/v1/menu/items', { categoryId: w.categoryId, name: 'Neg', price: -1 })).status).toBe(400);
    expect((await w.adminA1.post('/api/v1/menu/items', { categoryId: w.categoryId, name: 'Frac', price: 10.5 })).status).toBe(400);
    expect((await w.adminA1.post('/api/v1/menu/items', { categoryId: w.categoryId, name: 'NoPrice' })).status).toBe(400);
  });

  it('creates a branch item without an image and edits it', async () => {
    const item = ok<Item>(
      await w.adminA1.post('/api/v1/menu/items', { categoryId: w.categoryId, name: 'Rava Dosa', price: 6000, description: 'Crispy' }),
      201,
    );
    expect(item.imageUrl).toBeNull();
    expect(item.editable).toBe(true);
    const edited = ok<Item>(await w.adminA1.patch(`/api/v1/menu/items/${item.id}`, { name: 'Rava Masala Dosa', price: 6500 }));
    expect(edited.name).toBe('Rava Masala Dosa');
    expect(edited.price).toBe(6500);
    // Not visible to another branch.
    const a2 = ok<Item[]>(await w.adminA2.get('/api/v1/menu/items'));
    expect(a2.map((i) => i.name)).not.toContain('Rava Masala Dosa');
  });

  it('turns branch edits of shared items into overrides', async () => {
    expect((await w.adminA1.patch(`/api/v1/menu/items/${w.items.idly}`, { name: 'Renamed' })).status).toBe(403);
    const o = ok<Item>(await w.adminA1.patch(`/api/v1/menu/items/${w.items.idly}`, { price: 3300 }));
    expect(o.price).toBe(3300);
    expect(o.basePrice).toBe(3000);
    // Branch A2 still sees the shared price.
    const a2 = ok<Item[]>(await w.adminA2.get('/api/v1/menu/items'));
    expect(a2.find((i) => i.id === w.items.idly)?.price).toBe(3000);
    const reset = ok<Item>(await w.adminA1.delete(`/api/v1/menu/items/${w.items.idly}/override`));
    expect(reset.price).toBe(3000);
  });

  it('updates availability per branch', async () => {
    const off = ok<Item>(await w.adminA1.patch(`/api/v1/menu/items/${w.items.vada}/availability`, { isAvailable: false }));
    expect(off.isAvailable).toBe(false);
    const a2 = ok<Item[]>(await w.adminA2.get('/api/v1/menu/items'));
    expect(a2.find((i) => i.id === w.items.vada)?.isAvailable).toBe(true);
    ok(await w.adminA1.patch(`/api/v1/menu/items/${w.items.vada}/availability`, { isAvailable: true }));
  });

  it('archives instead of deleting', async () => {
    const item = ok<Item>(await w.adminA1.post('/api/v1/menu/items', { categoryId: w.categoryId, name: 'Temp', price: 100 }), 201);
    ok(await w.adminA1.post(`/api/v1/menu/items/${item.id}/archive`));
    const list = ok<Item[]>(await w.adminA1.get('/api/v1/menu/items'));
    expect(list.map((i) => i.id)).not.toContain(item.id);
    const all = ok<Item[]>(await w.adminA1.get('/api/v1/menu/items?includeArchived=true'));
    expect(all.map((i) => i.id)).toContain(item.id);
  });

  it('Super Admin manages the shared menu, visible in every branch', async () => {
    const item = ok<Item>(
      await w.sa.post(`/api/v1/menu/items?restaurantId=${w.restaurantA}`, { categoryId: w.categoryId, name: 'Kesari', price: 4000 }),
      201,
    );
    expect(item.isShared).toBe(false); // in restaurant scope it is "own"
    const a2 = ok<Item[]>(await w.adminA2.get('/api/v1/menu/items'));
    expect(a2.find((i) => i.id === item.id)?.isShared).toBe(true);
    // Restaurant B never sees it.
    const b = ok<Item[]>(await w.adminB1.get('/api/v1/menu/items'));
    expect(b.map((i) => i.id)).not.toContain(item.id);
  });
});

describe('images', () => {
  it('accepts a real PNG and serves it', async () => {
    const item = ok<Item>(await w.adminA1.post('/api/v1/menu/items', { categoryId: w.categoryId, name: 'Pic', price: 100 }), 201);
    const res = await w.adminA1.agent
      .post(`/api/v1/menu/items/${item.id}/image`)
      .set('X-Requested-With', 'rb-client')
      .set('X-Branch-Id', w.branchA1)
      .attach('image', PNG, { filename: 'pic.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.data.imageUrl).toMatch(/^\/uploads\/menu\/[0-9a-f-]+\.png$/);
    const served = await w.adminA1.agent.get(res.body.data.imageUrl);
    expect(served.status).toBe(200);
    expect(served.headers['x-content-type-options']).toBe('nosniff');
  });

  it('lets a branch use its own photo for a shared item without changing other branches', async () => {
    const res = await w.adminA1.agent
      .post(`/api/v1/menu/items/${w.items.dosa}/image`)
      .set('X-Requested-With', 'rb-client')
      .set('X-Branch-Id', w.branchA1)
      .attach('image', PNG, { filename: 'dosa.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ imageOverridden: true, editable: false });
    expect(res.body.data.imageUrl).toMatch(/^\/uploads\/menu\//);
    // The other branch and the main menu are untouched.
    const a2 = ok<(Item & { imageOverridden: boolean })[]>(await w.adminA2.get('/api/v1/menu/items'));
    expect(a2.find((i) => i.id === w.items.dosa)?.imageUrl).toBeNull();
    const main = ok<Item[]>(await w.sa.get(`/api/v1/menu/items?restaurantId=${w.restaurantA}`));
    expect(main.find((i) => i.id === w.items.dosa)?.imageUrl).toBeNull();
    // Resetting the branch price keeps the branch photo; removing the photo restores the main one.
    ok(await w.adminA1.patch(`/api/v1/menu/items/${w.items.dosa}`, { price: 5500 }));
    const reset = ok<Item & { imageOverridden: boolean }>(await w.adminA1.delete(`/api/v1/menu/items/${w.items.dosa}/override`));
    expect(reset).toMatchObject({ price: 5000, imageOverridden: true });
    const removed = ok<Item & { imageOverridden: boolean }>(await w.adminA1.delete(`/api/v1/menu/items/${w.items.dosa}/image`));
    expect(removed).toMatchObject({ imageUrl: null, imageOverridden: false });
  });

  it('rejects files that are not really images', async () => {
    const item = ok<Item>(await w.adminA1.post('/api/v1/menu/items', { categoryId: w.categoryId, name: 'Fake', price: 100 }), 201);
    const res = await w.adminA1.agent
      .post(`/api/v1/menu/items/${item.id}/image`)
      .set('X-Requested-With', 'rb-client')
      .set('X-Branch-Id', w.branchA1)
      .attach('image', Buffer.from('<svg onload="alert(1)"></svg>'), { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_IMAGE');
  });

  it('rejects oversized uploads', async () => {
    const item = ok<Item>(await w.adminA1.post('/api/v1/menu/items', { categoryId: w.categoryId, name: 'Huge', price: 100 }), 201);
    const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
    const res = await w.adminA1.agent
      .post(`/api/v1/menu/items/${item.id}/image`)
      .set('X-Requested-With', 'rb-client')
      .set('X-Branch-Id', w.branchA1)
      .attach('image', big, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
  });
});
