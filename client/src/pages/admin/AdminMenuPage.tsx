import { placeName, type BranchDTO, type RestaurantDTO } from '@rb/shared';
import { Pencil, Store, UtensilsCrossed } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ActiveBadge } from '../../components/badges';
import { FoodImage } from '../../components/FoodImage';
import { Empty, Loading, PageHeader } from '../../components/ui';
import { useCategories, useMenuItems } from '../../services/queries';
import { usePageSearch } from '../../store/topbar';
import { cx } from '../../utils/format';
import { groupVariants, priceLabel } from '../../utils/menu';
import { MenuManager } from '../restaurant/MenuPage';
import { ScopeSelect, useAllBranches, useRestaurants } from './adminShared';

/**
 * One restaurant's menu in the all-restaurants view, as its location sees it: the main menu plus
 * the dishes its admin added there (or the main menu alone for a restaurant without a location).
 */
function RestaurantMenuSection({
  restaurant,
  branchId,
  title,
  search,
  onManage,
  onEdit,
}: {
  restaurant: RestaurantDTO;
  branchId: string | null;
  title: string;
  search: string;
  onManage: () => void;
  onEdit: (itemId: string) => void;
}) {
  const scope = useMemo(() => (branchId ? { branchId } : { restaurantId: restaurant.id }), [branchId, restaurant.id]);
  const items = useMenuItems(scope);
  const categories = useCategories(scope);
  const categoryIcon = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c.icon])), [categories.data]);
  const q = search.trim().toLowerCase();
  const { dishes, variantsOf } = groupVariants(items.data ?? []);
  const visible = dishes.filter((i) => i.status === 'ACTIVE' && (!q || i.name.toLowerCase().includes(q)));
  if (q && !items.isLoading && visible.length === 0) return null; // hide sections with no search match

  return (
    <section className="menu-section">
      <div className="menu-section-head">
        <div className="row" style={{ minWidth: 0 }}>
          <Store size={22} color="var(--color-primary)" />
          <h2 className="card-title">{title}</h2>
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
                  <div className="food-price">{priceLabel(item, variantsOf.get(item.id))}</div>
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
  const branches = useAllBranches();
  // A restaurant with one location: its menu is that location's – where its admin adds dishes –
  // so the Super Admin sees and changes exactly what the restaurant bills from.
  const locations = (branches.data ?? []).filter((b) => b.restaurantId === restaurantId);
  const scopeBranchId = branchId || (locations.length === 1 ? locations[0].id : '');

  const selector = (
    <ScopeSelect
      restaurantId={restaurantId}
      branchId={branchId}
      allRestaurantsLabel="All restaurants"
      allBranchesLabel="Main menu (all locations)"
      onChange={(next) => go(next)}
    />
  );

  if (restaurantId) {
    if (branches.isLoading) return <Loading label="Loading menu…" />;
    return (
      <MenuManager
        key={`${restaurantId}:${scopeBranchId}`}
        scope={scopeBranchId ? { branchId: scopeBranchId } : { restaurantId }}
        headerExtra={selector}
        initialEditId={editId}
        onInitialEditOpened={clearEdit}
        taxSettings={restaurants.data?.find((r) => r.id === restaurantId)?.settings}
      />
    );
  }
  return (
    <AllRestaurantsMenu
      selector={selector}
      restaurants={restaurants.data}
      branches={branches.data}
      loading={restaurants.isLoading || branches.isLoading}
      onOpen={go}
    />
  );
}

function AllRestaurantsMenu({
  selector,
  restaurants,
  branches,
  loading,
  onOpen,
}: {
  selector: React.ReactNode;
  restaurants: RestaurantDTO[] | undefined;
  branches: BranchDTO[] | undefined;
  loading: boolean;
  onOpen: (next: { restaurantId: string; branchId?: string; edit?: string }) => void;
}) {
  const search = usePageSearch('Search food items in all restaurants...');
  return (
    <div className="page">
      <PageHeader title="Menu" subtitle="Every restaurant's menu – choose one to add dishes, categories or prices" actions={selector} />
      {loading ? (
        <Loading />
      ) : !restaurants?.length ? (
        <Empty icon={<Store />} title="No restaurants yet">
          Create a restaurant first.
        </Empty>
      ) : (
        <div className="stack" style={{ gap: 18 }}>
          {restaurants.flatMap((r) => {
            // One section per location (an older restaurant can have several), each as it bills.
            const locations = (branches ?? []).filter((b) => b.restaurantId === r.id);
            const sections = locations.length ? locations.map((b) => ({ branchId: b.id, title: placeName(r.name, b.name) })) : [{ branchId: null, title: r.name }];
            return sections.map((s) => {
              const where = { restaurantId: r.id, ...(s.branchId && { branchId: s.branchId }) };
              return (
                <RestaurantMenuSection
                  key={s.branchId ?? r.id}
                  restaurant={r}
                  branchId={s.branchId}
                  title={s.title}
                  search={search}
                  onManage={() => onOpen(where)}
                  onEdit={(itemId) => onOpen({ ...where, edit: itemId })}
                />
              );
            });
          })}
        </div>
      )}
    </div>
  );
}
