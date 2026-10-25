import type { RestaurantDTO } from '@rb/shared';
import { Pencil, Store, UtensilsCrossed } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ActiveBadge } from '../../components/badges';
import { FoodImage } from '../../components/FoodImage';
import { Empty, Loading, PageHeader } from '../../components/ui';
import { useCategories, useMenuItems } from '../../services/queries';
import { usePageSearch } from '../../store/topbar';
import { cx, formatMoney } from '../../utils/format';
import { MenuManager } from '../restaurant/MenuPage';
import { ScopeSelect, useRestaurants } from './adminShared';

/** One restaurant's main menu in the all-restaurants view. */
function RestaurantMenuSection({
  restaurant,
  search,
  onManage,
  onEdit,
}: {
  restaurant: RestaurantDTO;
  search: string;
  onManage: () => void;
  onEdit: (itemId: string) => void;
}) {
  const scope = useMemo(() => ({ restaurantId: restaurant.id }), [restaurant.id]);
  const items = useMenuItems(scope);
  const categories = useCategories(scope);
  const categoryIcon = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c.icon])), [categories.data]);
  const q = search.trim().toLowerCase();
  const visible = (items.data ?? []).filter((i) => i.status === 'ACTIVE' && (!q || i.name.toLowerCase().includes(q)));
  if (q && !items.isLoading && visible.length === 0) return null; // hide sections with no search match

  return (
    <section className="menu-section">
      <div className="menu-section-head">
        <div className="row" style={{ minWidth: 0 }}>
          <Store size={22} color="var(--color-primary)" />
          <h2 className="card-title">{restaurant.name}</h2>
          <ActiveBadge status={restaurant.status} />
          <span className="muted nowrap">
            {items.data ? `${visible.length} dish${visible.length === 1 ? '' : 'es'}` : ''}
          </span>
        </div>
        <button className="btn btn-outline btn-sm" onClick={onManage}>
          Manage menu
        </button>
      </div>
      {items.isLoading ? (
        <Loading label="Loading menu…" />
      ) : visible.length === 0 ? (
        <Empty icon={<UtensilsCrossed />} title="No dishes yet">
          <button className="btn btn-primary btn-sm" onClick={onManage}>
            Add the first dish
          </button>
        </Empty>
      ) : (
        <div className="menu-grid" style={{ marginTop: 12 }}>
          {visible.map((item) => (
            <div key={item.id} className={cx('menu-card', !item.isAvailable && 'unavailable')}>
              <div className="food-media">
                <FoodImage src={item.imageUrl} alt={item.name} emoji={categoryIcon.get(item.categoryId)} />
              </div>
              <div className="menu-card-tags">{!item.isAvailable && <span className="tag dark">Sold out</span>}</div>
              <div className="menu-card-body">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="food-name" title={item.name}>
                    {item.name}
                  </div>
                  <div className="food-price">{formatMoney(item.price)}</div>
                </div>
              </div>
              <div className="menu-card-actions">
                <button className="btn btn-soft btn-sm" onClick={() => onEdit(item.id)} aria-label={`Edit ${item.name}`}>
                  <Pencil /> Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Super Admin menu management. Opens on every restaurant's menu; choosing a restaurant (or
 * "Manage menu") shows its full menu page, and a branch shows branch-only dishes and prices.
 */
export function AdminMenuPage() {
  const [params, setParams] = useSearchParams();
  const restaurantId = params.get('restaurantId') ?? '';
  const branchId = params.get('branchId') ?? '';
  const editId = params.get('edit');
  const restaurants = useRestaurants();

  const go = useCallback(
    (next: { restaurantId?: string; branchId?: string; edit?: string }) => {
      const p = new URLSearchParams();
      if (next.restaurantId) p.set('restaurantId', next.restaurantId);
      if (next.branchId) p.set('branchId', next.branchId);
      if (next.edit) p.set('edit', next.edit);
      setParams(p, { replace: !next.edit });
    },
    [setParams],
  );
  const clearEdit = useCallback(() => go({ restaurantId, branchId }), [go, restaurantId, branchId]);

  const selector = (
    <ScopeSelect
      restaurantId={restaurantId}
      branchId={branchId}
      allRestaurantsLabel="All restaurants"
      allBranchesLabel="Main menu (all branches)"
      onChange={(next) => go(next)}
    />
  );

  if (restaurantId) {
    return (
      <MenuManager
        key={`${restaurantId}:${branchId}`}
        scope={branchId ? { branchId } : { restaurantId }}
        headerExtra={selector}
        initialEditId={editId}
        onInitialEditOpened={clearEdit}
      />
    );
  }
  return <AllRestaurantsMenu selector={selector} restaurants={restaurants.data} loading={restaurants.isLoading} onOpen={go} />;
}

function AllRestaurantsMenu({
  selector,
  restaurants,
  loading,
  onOpen,
}: {
  selector: React.ReactNode;
  restaurants: RestaurantDTO[] | undefined;
  loading: boolean;
  onOpen: (next: { restaurantId: string; edit?: string }) => void;
}) {
  const search = usePageSearch('Search food items in all restaurants...');
  return (
    <div className="page">
      <PageHeader title="Menu" subtitle="Every restaurant's main menu – choose one to add dishes, categories or branch prices" actions={selector} />
      {loading ? (
        <Loading />
      ) : !restaurants?.length ? (
        <Empty icon={<Store />} title="No restaurants yet">
          Create a restaurant first.
        </Empty>
      ) : (
        <div className="stack" style={{ gap: 18 }}>
          {restaurants.map((r) => (
            <RestaurantMenuSection
              key={r.id}
              restaurant={r}
              search={search}
              onManage={() => onOpen({ restaurantId: r.id })}
              onEdit={(itemId) => onOpen({ restaurantId: r.id, edit: itemId })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
