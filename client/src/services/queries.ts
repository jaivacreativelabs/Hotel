/** React Query hooks for server state. Keys include the scope so branches never mix. */
import type { CategoryDTO, DraftDTO, MenuItemDTO, TablesResponseDTO } from '@rb/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { savedQuery } from './savedQueries';

/** Menu scope: a branch (header/query) or, for the Super Admin, a whole restaurant. */
export interface MenuScope {
  branchId?: string | null;
  restaurantId?: string | null;
}

export const scopeQuery = (s: MenuScope) => (s.branchId ? { branchId: s.branchId } : { restaurantId: s.restaurantId ?? undefined });
const scopeKey = (s: MenuScope) => s.branchId ?? `r:${s.restaurantId}`;
const scopeReady = (s: MenuScope) => Boolean(s.branchId || s.restaurantId);

export const menuKeys = {
  all: ['menu'] as const,
  categories: (s: MenuScope, includeInactive = false) => ['menu', 'categories', scopeKey(s), includeInactive] as const,
  items: (s: MenuScope, includeArchived = false) => ['menu', 'items', scopeKey(s), includeArchived] as const,
};

export function useCategories(scope: MenuScope, includeInactive = false) {
  const queryKey = menuKeys.categories(scope, includeInactive);
  return useQuery({
    queryKey,
    queryFn: () =>
      api.get<CategoryDTO[]>('/menu/categories', {
        query: { ...scopeQuery(scope), includeInactive },
        branchId: scope.branchId ?? null,
      }),
    enabled: scopeReady(scope),
    ...savedQuery<CategoryDTO[]>(queryKey),
  });
}

export function useMenuItems(scope: MenuScope, includeArchived = false) {
  const queryKey = menuKeys.items(scope, includeArchived);
  return useQuery({
    queryKey,
    queryFn: () =>
      api.get<MenuItemDTO[]>('/menu/items', {
        query: { ...scopeQuery(scope), includeArchived },
        branchId: scope.branchId ?? null,
      }),
    enabled: scopeReady(scope),
    ...savedQuery<MenuItemDTO[]>(queryKey),
  });
}

export const tableKeys = { list: (branchId: string | null) => ['tables', branchId] as const };

export function useTables(branchId: string | null) {
  const queryKey = tableKeys.list(branchId);
  return useQuery({
    queryKey,
    queryFn: () => api.get<TablesResponseDTO>('/tables', { branchId }),
    enabled: Boolean(branchId),
    // Other admins may seat guests or bill tables at the same time.
    refetchInterval: 15_000,
    ...savedQuery<TablesResponseDTO>(queryKey),
  });
}

/** The branch's open counter (New Bill) bill. */
export const counterDraftQuery = (branchId: string) => ({
  queryKey: ['counter-draft', branchId],
  queryFn: () => api.get<DraftDTO>('/bills/counter'),
  staleTime: Infinity,
});
