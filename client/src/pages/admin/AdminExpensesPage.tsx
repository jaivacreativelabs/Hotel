import { placeName } from '@rb/shared';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExpensesView } from '../restaurant/ExpensesPage';
import { ScopeSelect, useAllBranches, useRestaurants } from './adminShared';

export function AdminExpensesPage() {
  const [params, setParams] = useSearchParams();
  const restaurantId = params.get('restaurantId') ?? '';
  const branchId = params.get('branchId') ?? '';
  const allBranches = useAllBranches().data;
  const restaurants = useRestaurants().data;
  // A restaurant with one branch needs no location choice to add an expense.
  const only = (allBranches ?? []).filter((b) => b.restaurantId === restaurantId);
  const addTo = branchId || (only.length === 1 ? only[0].id : '');
  // Without a restaurant in the filter, the Super Admin picks one in the Add Expense form.
  const places = useMemo(() => {
    const names = new Map((restaurants ?? []).map((r) => [r.id, r.name]));
    return (allBranches ?? [])
      .filter((b) => b.status === 'ACTIVE' && names.has(b.restaurantId))
      .map((b) => ({ id: b.id, label: placeName(names.get(b.restaurantId)!, b.name) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allBranches, restaurants]);
  const scope = useMemo(
    () => ({ ...(restaurantId && { restaurantId }), ...(branchId && { branchId }) }),
    [restaurantId, branchId],
  );
  return (
    <ExpensesView
      scope={scope}
      // The Super Admin adds an expense for the restaurant picked in the filter (or in the form).
      addBranchId={addTo || null}
      addPlaces={places}
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
