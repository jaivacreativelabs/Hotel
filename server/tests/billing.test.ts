import { beforeAll, describe, expect, it } from 'vitest';
import { DraftModel, TransactionModel } from '../src/models/index.js';
import { buildWorld, key, ok, useTestDatabase, type World } from './helpers.js';

useTestDatabase();

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});

interface Draft {
  id: string;
  version: number;
  status: string;
  items: { menuItemId: string; name: string; unitPrice: number; quantity: number }[];
  totals: { subtotal: number; taxTotal: number; grandTotal: number; discountAmount: number };
}
interface Tx {
  id: string;
  billNumber: string;
  grandTotal: number;
  subtotal: number;
  taxTotal: number;
  items: { name: string; unitPrice: number; quantity: number; lineTotal: number }[];
  paymentMethod: string;
  status: string;
}

async function freshCounter(): Promise<Draft> {
  return ok<Draft>(await w.adminA1.get('/api/v1/bills/counter'));
}

describe('counter (New Bill) drafts', () => {
  it('returns the same persisted counter draft on every call', async () => {
    const a = await freshCounter();
    const b = await freshCounter();
    expect(a.id).toBe(b.id);
    expect(a.items).toEqual([]);
  });

  it('adds items, changes quantities and removes items with server-side pricing', async () => {
    let d = await freshCounter();
    d = ok<Draft>(
      await w.adminA1.put(`/api/v1/bills/${d.id}`, {
        version: d.version,
        items: [
          { menuItemId: w.items.idly, quantity: 2 },
          { menuItemId: w.items.dosa, quantity: 1 },
        ],
        customerName: 'Ravi',
      }),
    );
    expect(d.items.map((i) => [i.name, i.unitPrice, i.quantity])).toEqual([
      ['Idly', 3000, 2],
      ['Dosa', 5000, 1],
    ]);
    expect(d.totals.grandTotal).toBe(11000);

    d = ok<Draft>(await w.adminA1.put(`/api/v1/bills/${d.id}`, { version: d.version, items: [{ menuItemId: w.items.idly, quantity: 3 }] }));
    expect(d.items).toHaveLength(1);
    expect(d.totals.grandTotal).toBe(9000);
  });

  it('ignores any price or total the client tries to send', async () => {
    const d = await freshCounter();
    const res = await w.adminA1.put(`/api/v1/bills/${d.id}`, {
      version: d.version,
      items: [{ menuItemId: w.items.idly, quantity: 1, unitPrice: 1 }],
    });
    expect(res.status).toBe(400); // unknown field rejected
    const res2 = await w.adminA1.put(`/api/v1/bills/${d.id}`, { version: d.version, items: [], grandTotal: 1 });
    expect(res2.status).toBe(400);
  });

  it('rejects stale versions with 409 and the current draft', async () => {
    const d = await freshCounter();
    const res = await w.adminA1.put(`/api/v1/bills/${d.id}`, { version: d.version - 1, items: [] });
    expect(res.status).toBe(409);
    expect(res.body.error.details.current.version).toBe(d.version);
  });

  it('prevents adding unavailable items', async () => {
    ok(await w.adminA1.patch(`/api/v1/menu/items/${w.items.vada}/availability`, { isAvailable: false }));
    const d = await freshCounter();
    const res = await w.adminA1.put(`/api/v1/bills/${d.id}`, {
      version: d.version,
      items: [...d.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })), { menuItemId: w.items.vada, quantity: 1 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ITEM_UNAVAILABLE');
    ok(await w.adminA1.patch(`/api/v1/menu/items/${w.items.vada}/availability`, { isAvailable: true }));
  });

  it('applies restaurant tax settings and discounts on the server', async () => {
    ok(
      await w.sa.patch(`/api/v1/admin/restaurants/${w.restaurantA}/settings`, {
        taxes: [
          { name: 'CGST', rateBps: 250 },
          { name: 'SGST', rateBps: 250 },
        ],
        pricesIncludeTax: false,
        receiptFooter: 'Thanks',
      }),
    );
    const d = await freshCounter();
    const updated = ok<Draft>(
      await w.adminA1.put(`/api/v1/bills/${d.id}`, {
        version: d.version,
        items: [{ menuItemId: w.items.biryani, quantity: 1 }],
        discount: { type: 'PERCENT', value: 1000 },
      }),
    );
    expect(updated.totals.subtotal).toBe(8000);
    expect(updated.totals.discountAmount).toBe(800);
    expect(updated.totals.taxTotal).toBe(360);
    expect(updated.totals.grandTotal).toBe(7560);
  });
});

describe('finalising bills', () => {
  it('creates a transaction with snapshots and closes the draft', async () => {
    const d = await freshCounter();
    const res = await w.adminA1.post(`/api/v1/bills/${d.id}/finalize`, { version: d.version, paymentMethod: 'UPI', idempotencyKey: key() });
    expect(res.status).toBe(201);
    const tx = res.body.data.transaction as Tx;
    expect(tx.billNumber).toBe('B00001');
    expect(tx.grandTotal).toBe(7560);
    expect(tx.items[0]).toMatchObject({ name: 'Biryani', unitPrice: 8000, quantity: 1, lineTotal: 8000 });
    const draft = await DraftModel.findById(d.id).lean();
    expect(draft?.status).toBe('FINALIZED');
    // A new counter draft is opened for the next customer.
    const next = await freshCounter();
    expect(next.id).not.toBe(d.id);
    expect(next.items).toEqual([]);
  });

  it('rejects an empty bill', async () => {
    const d = await freshCounter();
    const res = await w.adminA1.post(`/api/v1/bills/${d.id}/finalize`, { version: d.version, paymentMethod: 'CASH', idempotencyKey: key() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMPTY_BILL');
  });

  it('is idempotent for repeated clicks with the same key', async () => {
    let d = await freshCounter();
    d = ok<Draft>(await w.adminA1.put(`/api/v1/bills/${d.id}`, { version: d.version, items: [{ menuItemId: w.items.coffee, quantity: 2 }] }));
    const k = key();
    const first = await w.adminA1.post(`/api/v1/bills/${d.id}/finalize`, { version: d.version, paymentMethod: 'CASH', idempotencyKey: k });
    const second = await w.adminA1.post(`/api/v1/bills/${d.id}/finalize`, { version: d.version, paymentMethod: 'CASH', idempotencyKey: k });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.transaction.id).toBe(first.body.data.transaction.id);
    expect(await TransactionModel.countDocuments({ sourceDraftId: d.id })).toBe(1);
  });

  it('creates exactly one transaction under concurrent finalise calls', async () => {
    let d = await freshCounter();
    d = ok<Draft>(await w.adminA1.put(`/api/v1/bills/${d.id}`, { version: d.version, items: [{ menuItemId: w.items.dosa, quantity: 1 }] }));
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        w.adminA1.post(`/api/v1/bills/${d.id}/finalize`, { version: d.version, paymentMethod: 'CARD', idempotencyKey: key() }),
      ),
    );
    const okResults = results.filter((r) => r.status === 200 || r.status === 201);
    expect(okResults.length).toBeGreaterThanOrEqual(1);
    expect(new Set(okResults.map((r) => r.body.data.transaction.id)).size).toBe(1);
    for (const r of results) expect([200, 201, 409]).toContain(r.status);
    expect(await TransactionModel.countDocuments({ sourceDraftId: d.id })).toBe(1);
  });

  it('keeps historical prices after the menu price changes', async () => {
    let d = await freshCounter();
    d = ok<Draft>(await w.adminA1.put(`/api/v1/bills/${d.id}`, { version: d.version, items: [{ menuItemId: w.items.juice, quantity: 1 }] }));
    const tx = (await w.adminA1.post(`/api/v1/bills/${d.id}/finalize`, { version: d.version, paymentMethod: 'CASH', idempotencyKey: key() })).body
      .data.transaction as Tx;
    ok(await w.sa.patch(`/api/v1/menu/items/${w.items.juice}?restaurantId=${w.restaurantA}`, { price: 9900, name: 'Juice Deluxe' }));
    const again = ok<Tx>(await w.adminA1.get(`/api/v1/transactions/${tx.id}`));
    expect(again.items[0]).toMatchObject({ name: 'Fresh Juice', unitPrice: 5000 });
    expect(again.grandTotal).toBe(tx.grandTotal);
  });

  it('refuses to finalise a draft containing an item that became unavailable', async () => {
    let d = await freshCounter();
    d = ok<Draft>(await w.adminA1.put(`/api/v1/bills/${d.id}`, { version: d.version, items: [{ menuItemId: w.items.vada, quantity: 1 }] }));
    ok(await w.adminA1.patch(`/api/v1/menu/items/${w.items.vada}/availability`, { isAvailable: false }));
    const res = await w.adminA1.post(`/api/v1/bills/${d.id}/finalize`, { version: d.version, paymentMethod: 'CASH', idempotencyKey: key() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ITEM_UNAVAILABLE');
    // Lowering the quantity / removing it is still allowed.
    ok(await w.adminA1.put(`/api/v1/bills/${d.id}`, { version: d.version, items: [] }));
    ok(await w.adminA1.patch(`/api/v1/menu/items/${w.items.vada}/availability`, { isAvailable: true }));
  });

  it('blocks rewriting completed transactions at the model level', async () => {
    const tx = await TransactionModel.findOne();
    await expect(TransactionModel.updateOne({ _id: tx!._id }, { $set: { grandTotal: 1 } })).rejects.toThrow(/immutable/);
    await expect(TransactionModel.deleteOne({ _id: tx!._id })).rejects.toThrow(/cannot be deleted/);
  });
});
