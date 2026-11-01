/**
 * The menu and the tables, kept on the device. iPad Safari often reloads the app after another
 * app was used; with these the screens show at once from the last copy and refresh in the
 * background, instead of "Loading…". Cleared on every sign-in and sign-out.
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query';

const PREFIX = 'rb-saved:';
/** First part of the query keys that are kept (see queries.ts). */
const KEPT = new Set(['menu', 'tables']);

interface Saved {
  data: unknown;
  at: number;
}

const parsed = new Map<string, Saved | null>();
const storageKey = (key: QueryKey) => PREFIX + JSON.stringify(key);

function read(key: QueryKey): Saved | null {
  const k = storageKey(key);
  if (!parsed.has(k)) {
    let saved: Saved | null = null;
    try {
      const raw = localStorage.getItem(k);
      saved = raw ? (JSON.parse(raw) as Saved) : null;
    } catch {
      /* storage unavailable or damaged – load from the server */
    }
    parsed.set(k, saved);
  }
  return parsed.get(k)!;
}

/** useQuery options that start from the kept copy (refetched at once, as it counts as old). */
export function savedQuery<T>(key: QueryKey) {
  return {
    initialData: () => read(key)?.data as T | undefined,
    initialDataUpdatedAt: () => read(key)?.at,
  };
}

/** Keeps every fresh menu / tables answer on the device. */
export function keepSavedQueries(queryClient: QueryClient) {
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    const { queryKey, state } = event.query;
    if (!KEPT.has(queryKey[0] as string) || state.data === undefined) return;
    const saved: Saved = { data: state.data, at: state.dataUpdatedAt };
    const k = storageKey(queryKey);
    parsed.set(k, saved);
    try {
      localStorage.setItem(k, JSON.stringify(saved));
    } catch {
      /* storage full or blocked – it still works, only without the head start */
    }
  });
}

export function clearSavedQueries() {
  parsed.clear();
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* storage unavailable */
  }
}
