import type { MenuItemDTO } from '@rb/shared';
import { LayoutGrid, Pin, UtensilsCrossed } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCategories, useMenuItems } from '../services/queries';
import type { LocalBill } from '../store/draftSync';
import { cx, formatMoney } from '../utils/format';
import { FoodImage } from './FoodImage';
import { Empty, Loading } from './ui';

/** Adds one of `item` to a bill (or increases its quantity). */
export function addItemToBill(bill: LocalBill, item: MenuItemDTO): LocalBill {
  const existing = bill.items.find((i) => i.menuItemId === item.id);
  if (existing) {
    return { ...bill, items: bill.items.map((i) => (i.menuItemId === item.id ? { ...i, quantity: Math.min(999, i.quantity + 1) } : i)) };
  }
  return {
    ...bill,
    items: [...bill.items, { menuItemId: item.id, name: item.name, imageUrl: item.imageUrl, unitPrice: item.price, taxable: item.taxable, quantity: 1, unavailable: false }],
  };
}

/** Changes a line's quantity; 0 removes it. */
export function setBillQuantity(bill: LocalBill, menuItemId: string, quantity: number): LocalBill {
  return {
    ...bill,
    items:
      quantity <= 0
        ? bill.items.filter((i) => i.menuItemId !== menuItemId)
        : bill.items.map((i) => (i.menuItemId === menuItemId ? { ...i, quantity: Math.min(999, quantity) } : i)),
  };
}

/** Category chips + food cards for the branch menu. Used by New Bill and table ordering. */
export function FoodGrid({
  branchId,
  search,
  qtyById,
  editable,
  onAdd,
}: {
  branchId: string;
  search: string;
  qtyById: Map<string, number>;
  editable: boolean;
  onAdd: (item: MenuItemDTO) => void;
}) {
  const scope = useMemo(() => ({ branchId }), [branchId]);
  const categories = useCategories(scope);
  const items = useMenuItems(scope);
  const [category, setCategory] = useState<string>('all');

  const activeCategoryIds = useMemo(() => new Set((categories.data ?? []).map((c) => c.id)), [categories.data]);
  // Category picture for dishes without a photo, so they stay recognisable.
  const categoryIcon = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c.icon])), [categories.data]);
  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (items.data ?? []).filter(
      (i) => activeCategoryIds.has(i.categoryId) && (category === 'all' || i.categoryId === category) && (!q || i.name.toLowerCase().includes(q)),
    );
  }, [items.data, activeCategoryIds, category, search]);

  const add = (item: MenuItemDTO) => {
    if (editable && item.isAvailable) onAdd(item);
  };

  return (
    <>
      <div className="chips" role="tablist" aria-label="Categories">
        <button className={cx('chip', category === 'all' && 'active')} onClick={() => setCategory('all')} role="tab" aria-selected={category === 'all'}>
          <LayoutGrid /> All
        </button>
        {(categories.data ?? []).map((c) => (
          <button key={c.id} className={cx('chip', category === c.id && 'active')} onClick={() => setCategory(c.id)} role="tab" aria-selected={category === c.id}>
            {c.icon && <span className="chip-icon">{c.icon}</span>}
            {c.name}
          </button>
        ))}
      </div>

      {items.isLoading ? (
        <Loading label="Loading menu…" />
      ) : visibleItems.length === 0 ? (
        <Empty icon={<UtensilsCrossed />} title={search ? 'No items match your search' : 'No items in the menu yet'}>
          {!search && <Link to="/menu">Add food items in Menu</Link>}
        </Empty>
      ) : (
        <div className="food-grid">
          {visibleItems.map((item) => {
            const qty = qtyById.get(item.id);
            return (
              <div
                key={item.id}
                className={cx('food-card', !item.isAvailable && 'disabled')}
                onClick={() => add(item)}
                role="button"
                tabIndex={item.isAvailable ? 0 : -1}
                aria-disabled={!item.isAvailable}
                aria-label={`Add ${item.name}`}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), add(item))}
              >
                <div className="food-media">
                  <FoodImage src={item.imageUrl} alt={item.name} emoji={categoryIcon.get(item.categoryId)} />
                </div>
                {qty ? <span className="food-qty-badge">{qty}</span> : null}
                {!item.isAvailable && <span className="unavailable-tag">Unavailable</span>}
                {item.isAvailable && item.pinned && (
                  <span className="pin-mark" title="Pinned">
                    <Pin size={14} />
                  </span>
                )}
                <div className="food-body">
                  <div style={{ minWidth: 0 }}>
                    <div className="food-name">{item.name}</div>
                    <div className="food-price">{formatMoney(item.price)}</div>
                  </div>
                  <button
                    className="btn btn-primary"
                    tabIndex={-1}
                    disabled={!item.isAvailable || !editable}
                    onClick={(e) => {
                      e.stopPropagation();
                      add(item);
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
