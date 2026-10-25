/** Kitchen Display helpers shared by the server and the billing screens. */

export interface KitchenQty {
  menuItemId: string;
  quantity: number;
}

/** How many portions on the bill have not gone to the kitchen yet. */
export function kitchenPending(items: KitchenQty[], sent: KitchenQty[]): number {
  const done = new Map(sent.map((s) => [s.menuItemId, s.quantity]));
  return items.reduce((n, i) => n + Math.max(0, i.quantity - (done.get(i.menuItemId) ?? 0)), 0);
}
