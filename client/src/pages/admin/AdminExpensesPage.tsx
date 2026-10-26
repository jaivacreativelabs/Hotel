import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExpensesView } from '../restaurant/ExpensesPage';
import { ScopeSelect } from './adminShared';

export function AdminExpensesPage() {
  const [params, setParams] = useSearchParams();
  const restaurantId = params.get('restaurantId') ?? '';
  const branchId = params.get('branchId') ?? '';
  const scope = useMemo(
    () => ({ ...(restaurantId && { restaurantId }), ...(branchId && { branchId }) }),
    [restaurantId, branchId],
  );
  return (
    <ExpensesView
      scope={scope}
      // The Super Admin adds an expense for the branch picked in the filter.
      addBranchId={branchId || null}
      showBranch
      scopeFilters={
        <ScopeSelect
          restaurantId={restaurantId}
          branchId={branchId}
          onChange={(next) => {
            const p = new URLSearchParams();
            if (next.restaurantId) p.set('restaurantId', next.restaurantId);
            if (next.branchId) p.set('branchId', next.branchId);
            setParams(p, { replace: true });
          }}
        />
      }
    />
  );
}
