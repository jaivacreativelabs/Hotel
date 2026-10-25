import { Store } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Empty, PageHeader } from '../../components/ui';
import { MenuManager } from '../restaurant/MenuPage';
import { ScopeSelect } from './adminShared';

/** Super Admin menu management: pick a restaurant, then the shared menu or one branch. */
export function AdminMenuPage() {
  const [params, setParams] = useSearchParams();
  const restaurantId = params.get('restaurantId') ?? '';
  const branchId = params.get('branchId') ?? '';
  const selector = (
    <ScopeSelect
      restaurantId={restaurantId}
      branchId={branchId}
      requireRestaurant
      allBranchesLabel="Shared menu (all branches)"
      onChange={(next) => {
        const p = new URLSearchParams();
        if (next.restaurantId) p.set('restaurantId', next.restaurantId);
        if (next.branchId) p.set('branchId', next.branchId);
        setParams(p, { replace: true });
      }}
    />
  );

  if (!restaurantId) {
    return (
      <div className="page">
        <PageHeader title="Menu" subtitle="Choose a restaurant to manage its menu" actions={selector} />
        <Empty icon={<Store />} title="Select a restaurant">
          The shared menu applies to every branch; choose a branch to set branch-only items or branch prices.
        </Empty>
      </div>
    );
  }
  return <MenuManager key={`${restaurantId}:${branchId}`} scope={branchId ? { branchId } : { restaurantId }} headerExtra={selector} />;
}
