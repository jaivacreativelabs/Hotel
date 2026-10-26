import type { MenuItemDTO } from '@rb/shared';
import { formatMoney } from './format';

/** Dishes to list (variants are shown inside their dish) and each dish's live variants, cheapest first. */
export function groupVariants(items: MenuItemDTO[]): { dishes: MenuItemDTO[]; variantsOf: Map<string, MenuItemDTO[]> } {
  const variantsOf = new Map<string, MenuItemDTO[]>();
  for (const i of items) {
    if (!i.parentId || i.status !== 'ACTIVE') continue;
    variantsOf.set(i.parentId, [...(variantsOf.get(i.parentId) ?? []), i]);
  }
  for (const list of variantsOf.values()) list.sort((a, b) => a.price - b.price);
  return { dishes: items.filter((i) => !i.parentId), variantsOf };
}

/** "₹50" or, for a dish with variants, "from ₹50". */
export function priceLabel(dish: MenuItemDTO, variants: MenuItemDTO[] | undefined): string {
  if (!variants?.length) return formatMoney(dish.price);
  const prices = variants.map((v) => v.price);
  const low = Math.min(...prices);
  return low === Math.max(...prices) ? formatMoney(low) : `from ${formatMoney(low)}`;
}

/** "Rose Milk (Large)" → { dish: "Rose Milk", variant: "Large" }, so the size is never cut off. */
export function splitVariant(name: string): { dish: string; variant: string } {
  const m = /^(.+) \(([^()]+)\)$/.exec(name);
  return m ? { dish: m[1], variant: m[2] } : { dish: name, variant: '' };
}
