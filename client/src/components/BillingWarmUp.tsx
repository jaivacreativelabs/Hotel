import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { counterDraftQuery, useCategories, useMenuItems, useTables } from '../services/queries';
import { prefetchDrafts } from '../store/draftSync';

/**
 * Keeps what billing needs ready on every page – the menu, the tables and every open bill – so
 * New Bill, a table or Add Items open without "Loading…". The tables' 15 s refresh also keeps
 * the server awake, so taps are not slowed by it starting up again.
 */
export function BillingWarmUp({ branchId }: { branchId: string }) {
  const scope = useMemo(() => ({ branchId }), [branchId]);
  useCategories(scope);
  useMenuItems(scope);
  const tables = useTables(branchId);
  const counter = useQuery(counterDraftQuery(branchId));

  useEffect(() => {
    const groups = (tables.data?.tables ?? []).flatMap((t) => t.groups.map((g) => ({ id: g.draftId, version: g.version })));
    const bills = counter.data && counter.data.status === 'ACTIVE' ? [...groups, { id: counter.data.id, version: counter.data.version }] : groups;
    prefetchDrafts(bills, branchId);
  }, [tables.data, counter.data, branchId]);

  return null;
}
