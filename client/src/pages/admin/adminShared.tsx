import type { BranchDTO, RestaurantDTO } from '@rb/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';

export const adminKeys = {
  restaurants: ['admin', 'restaurants'] as const,
  restaurant: (id: string) => ['admin', 'restaurant', id] as const,
  branches: ['admin', 'branches'] as const,
  users: ['admin', 'users'] as const,
};

export function useRestaurants() {
  return useQuery({ queryKey: adminKeys.restaurants, queryFn: () => api.get<RestaurantDTO[]>('/admin/restaurants', { branchId: null }) });
}

export function useAllBranches() {
  return useQuery({ queryKey: adminKeys.branches, queryFn: () => api.get<BranchDTO[]>('/admin/branches', { branchId: null }) });
}

/** Restaurant + branch selectors used by Super Admin menu, transactions, reports and analytics. */
export function ScopeSelect({
  restaurantId,
  branchId,
  onChange,
  allRestaurantsLabel = 'All restaurants',
  allBranchesLabel = 'All branches',
  requireRestaurant = false,
}: {
  restaurantId: string;
  branchId: string;
  onChange: (next: { restaurantId: string; branchId: string }) => void;
  allRestaurantsLabel?: string;
  allBranchesLabel?: string;
  requireRestaurant?: boolean;
}) {
  const restaurants = useRestaurants();
  const branches = useAllBranches();
  const branchOptions = (branches.data ?? []).filter((b) => b.restaurantId === restaurantId);
  return (
    <>
      <select
        className="select select-sm"
        style={{ width: 220 }}
        value={restaurantId}
        onChange={(e) => onChange({ restaurantId: e.target.value, branchId: '' })}
        aria-label="Restaurant"
      >
        {requireRestaurant ? <option value="">Select restaurant</option> : <option value="">{allRestaurantsLabel}</option>}
        {(restaurants.data ?? []).map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
            {r.status === 'INACTIVE' ? ' (inactive)' : ''}
          </option>
        ))}
      </select>
      <select
        className="select select-sm"
        style={{ width: 220 }}
        value={branchId}
        disabled={!restaurantId}
        onChange={(e) => onChange({ restaurantId, branchId: e.target.value })}
        aria-label="Branch"
      >
        <option value="">{allBranchesLabel}</option>
        {branchOptions.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} ({b.code}){b.status === 'INACTIVE' ? ' – inactive' : ''}
          </option>
        ))}
      </select>
    </>
  );
}
