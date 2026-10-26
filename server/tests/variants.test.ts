import { beforeAll, describe, expect, it } from 'vitest';
import { buildWorld, key, ok, useTestDatabase, type Client, type World } from './helpers.js';

useTestDatabase();

interface Item {
  id: string;
  name: string;
  price: number;
  isAvailable: boolean;
  parentId: string | null;
  variantName: string;
}
interface Draft {
  id: string;
  version: number;
  items: { menuItemId: string; name: string; unitPrice: number; quantity: number; unavailable: boolean }[];
}

let w: World;
let dosa: Item;
let variants: Item[];
const menuOf = (r: string) => `/api/v1/menu/items?restaurantId=${r}`;
const putVariants = (c: Client, itemId: string, rows: { id?: string; name: string; price: number; isAvailable?: boolean }[], q = '') =>
  c.put(`/api/v1/menu/items/${itemId}/variants${q}`, { variants: rows });
const byName = (list: Item[], v: string) => list.find((x) => x.variantName === v)!;
async function counter(c: Client) {
  return ok<Draft>(await c.get('/api/v1/bills/counter'));
}
async function save(c: Client, d: Draft, items: [string, number][]) {
  return c.put(`/api/v1/bills/${d.id}`, { version: d.version, items: items.map(([menuItemId, quantity]) => ({ menuItemId, quantity })) });
}

beforeAll(async () => {
  w = await buildWorld();
  dosa = ok<Item>(await w.sa.post(menuOf(w.restaurantA), { categoryId: w.categoryId, name: 'Masala Roast', price: 6000 }), 201);
});

describe('adding variants to a dish', () => {
  it('creates each variant as an orderable item named after the dish', async () => {
    variants = ok<Item[]>(await putVariants(w.sa, dosa.id, [{ name: 'Plain', price: 5000 }, { name: 'Ghee', price: 9000 }, { name: 'Onion', price: 7000 }], `?restaurantId=${w.restaurantA}`));
    expect(variants.map((v) => [v.name, v.price, v.parentId])).toEqual([
      ['Masala Roast (Plain)', 5000, dosa.id],
      ['Masala Roast (Onion)', 7000, dosa.id],
      ['Masala Roast (Ghee)', 9000, dosa.id],
    ]);
    const list = ok<Item[]>(await w.adminA1.get('/api/v1/menu/items'));
    expect(list.find((i) => i.id === dosa.id)!.price).toBe(5000); // "from ₹50"
    expect(list.filter((i) => i.parentId === dosa.id)).toHaveLength(3);
  });

  it('bills the variant, not the dish', async () => {
    let d = await counter(w.adminA1);
    const parent = await save(w.adminA1, d, [[dosa.id, 1]]);
    expect([parent.status, parent.body.error.code]).toEqual([400, 'ITEM_UNAVAILABLE']);
    d = ok<Draft>(await save(w.adminA1, d, [[byName(variants, 'Ghee').id, 2]]));
    expect(d.items.map((i) => [i.name, i.unitPrice, i.quantity])).toEqual([['Masala Roast (Ghee)', 9000, 2]]);
    const res = await w.adminA1.post(`/api/v1/bills/${d.id}/finalize`, { version: d.version, paymentMethod: 'CASH', idempotencyKey: key() });
    expect(res.status).toBe(201);
    expect(res.body.data.transaction.items[0].name).toBe('Masala Roast (Ghee)');
    expect(res.body.data.transaction.grandTotal).toBe(18000);
  });

  it('renames, removes and re-adds variants; names follow the dish', async () => {
    const plain = byName(variants, 'Plain');
    const onion = byName(variants, 'Onion');
    const ghee = byName(variants, 'Ghee');
    let now = ok<Item[]>(
      await putVariants(w.sa, dosa.id, [{ id: plain.id, name: 'Plain', price: 5500 }, { id: ghee.id, name: 'Ghee Roast', price: 9000 }], `?restaurantId=${w.restaurantA}`),
    );
    expect(now.map((v) => v.name)).toEqual(['Masala Roast (Plain)', 'Masala Roast (Ghee Roast)']);
    // Onion was removed – it can be added again under the same name.
    now = ok<Item[]>(
      await putVariants(
        w.sa,
        dosa.id,
        [{ id: plain.id, name: 'Plain', price: 5500 }, { id: ghee.id, name: 'Ghee Roast', price: 9000 }, { name: 'Onion', price: 7000 }],
        `?restaurantId=${w.restaurantA}`,
      ),
    );
    expect(now).toHaveLength(3);
    expect(now.find((v) => v.variantName === 'Onion')!.id).not.toBe(onion.id);

    ok(await w.sa.patch(`/api/v1/menu/items/${dosa.id}?restaurantId=${w.restaurantA}`, { name: 'Roast Dosa' }));
    const list = ok<Item[]>(await w.sa.get(menuOf(w.restaurantA)));
    expect(list.filter((i) => i.parentId === dosa.id).map((i) => i.name).sort()).toEqual(['Roast Dosa (Ghee Roast)', 'Roast Dosa (Onion)', 'Roast Dosa (Plain)']);
    variants = list.filter((i) => i.parentId === dosa.id);
  });

  it('lets a branch price main-menu variants and add its own, but not remove shared ones', async () => {
    const rows = variants.map((v) => ({ id: v.id, name: v.variantName, price: v.price }));
    expect((await putVariants(w.adminA1, dosa.id, rows.slice(1))).status).toBe(403);

    const plain = byName(variants, 'Plain');
    const cheaper = rows.map((r) => (r.id === plain.id ? { ...r, price: 4500 } : r));
    const mine = ok<Item[]>(await putVariants(w.adminA1, dosa.id, [...cheaper, { name: 'Paneer', price: 9900 }]));
    expect(mine.map((v) => v.variantName)).toContain('Paneer');
    const a1 = ok<Item[]>(await w.adminA1.get('/api/v1/menu/items'));
    const a2 = ok<Item[]>(await w.adminA2.get('/api/v1/menu/items'));
    expect(a1.find((i) => i.id === plain.id)!.price).toBe(4500);
    expect(a2.find((i) => i.id === plain.id)!.price).toBe(5500);
    // The branch's own variant is only on its own menu.
    expect(a1.some((i) => i.name === 'Roast Dosa (Paneer)')).toBe(true);
    expect(a2.some((i) => i.name === 'Roast Dosa (Paneer)')).toBe(false);
  });

  it('lets a branch give a shared dish variants without changing other branches', async () => {
    const idly = await w.adminA1.put(`/api/v1/menu/items/${w.items.idly}/variants`, {
      variants: [
        { name: 'Mini', price: 2000 },
        { name: 'Ghee', price: 4000 },
      ],
    });
    const mini = ok<Item[]>(idly).find((v) => v.variantName === 'Mini')!;
    expect(mini.name).toBe('Idly (Mini)');
    // A1 now orders Idly by variant; A2 still orders plain Idly.
    const d1 = await counter(w.adminA1);
    expect((await save(w.adminA1, d1, [[w.items.idly, 1]])).status).toBe(400);
    expect((await save(w.adminA1, d1, [[mini.id, 2]])).status).toBe(200);
    const d2 = await counter(w.adminA2);
    expect((await save(w.adminA2, d2, [[w.items.idly, 1]])).status).toBe(200);
    expect((await save(w.adminA2, await counter(w.adminA2), [[mini.id, 1]])).status).toBe(400);
  });

  it('makes every variant unavailable when the dish is sold out', async () => {
    ok(await w.adminA1.patch(`/api/v1/menu/items/${dosa.id}/availability`, { isAvailable: false }));
    const d = await counter(w.adminA1);
    const res = await save(w.adminA1, d, [[byName(variants, 'Onion').id, 1]]);
    expect([res.status, res.body.error.code]).toEqual([400, 'ITEM_UNAVAILABLE']);
    ok(await w.adminA1.patch(`/api/v1/menu/items/${dosa.id}/availability`, { isAvailable: true }));
    expect((await save(w.adminA1, d, [[byName(variants, 'Onion').id, 1]])).status).toBe(200);
  });

  it('puts the variant quantity in its name on bills', async () => {
    const parotta = ok<Item>(await w.sa.post(menuOf(w.restaurantA), { categoryId: w.categoryId, name: 'Parotta', price: 2000 }), 201);
    const rows = ok<(Item & { variantQty: string })[]>(
      await putVariants(w.sa, parotta.id, [{ name: 'Half', qty: '1 pc', price: 2000 }, { name: 'Full', qty: '2 pcs', price: 3800 }, { name: 'Set', price: 9000 }], `?restaurantId=${w.restaurantA}`),
    );
    expect(rows.map((r) => [r.name, r.variantQty])).toEqual([
      ['Parotta (Half, 1 pc)', '1 pc'],
      ['Parotta (Full, 2 pcs)', '2 pcs'],
      ['Parotta (Set)', ''],
    ]);
    ok(await w.sa.patch(`/api/v1/menu/items/${parotta.id}?restaurantId=${w.restaurantA}`, { name: 'Kerala Parotta' }));
    const list = ok<Item[]>(await w.adminA1.get('/api/v1/menu/items'));
    expect(list.find((i) => i.id === rows[1].id)!.name).toBe('Kerala Parotta (Full, 2 pcs)');
  });

  it('refuses variants of a variant and duplicate names', async () => {
    expect((await putVariants(w.sa, byName(variants, 'Plain').id, [{ name: 'Small', price: 100 }], `?restaurantId=${w.restaurantA}`)).status).toBe(400);
    expect((await putVariants(w.sa, dosa.id, [{ name: 'Half', price: 100 }, { name: 'half', price: 200 }], `?restaurantId=${w.restaurantA}`)).status).toBe(400);
  });
});
