import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExpensesView } from '../restaurant/ExpensesPage';
import { ScopeSelect, useAllBranches } from './adminShared';

export function AdminExpensesPage() {
  const [params, setParams] = useSearchParams();
  const restaurantId = params.get('restaurantId') ?? '';
  const branchId = params.get('branchId') ?? '';
  // A restaurant with one branch needs no location choice to add an expense.
  const only = (useAllBranches().data ?? []).filter((b) => b.restaurantId === restaurantId);
  const addTo = branchId || (only.length === 1 ? only[0].id : '');
  const scope = useMemo(
    () => ({ ...(restaurantId && { restaurantId }), ...(branchId && { branchId }) }),
    [restaurantId, branchId],
  );
  return (
    <ExpensesView
      scope={scope}
      // The Super Admin adds an expense for the restaurant picked in the filter.
      addBranchId={addTo || null}
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
