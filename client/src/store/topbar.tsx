/** Lets each page own the shared top-bar search box (placeholder + value) and an extra slot. */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface TopbarState {
  placeholder: string | null;
  query: string;
  extra: ReactNode;
  setQuery: (q: string) => void;
  configure: (placeholder: string | null) => void;
  setExtra: (node: ReactNode) => void;
}

const TopbarContext = createContext<TopbarState | null>(null);

export function TopbarProvider({ children }: { children: ReactNode }) {
  const [placeholder, configure] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [extra, setExtra] = useState<ReactNode>(null);
  const value = useMemo(() => ({ placeholder, query, extra, setQuery, configure, setExtra }), [placeholder, query, extra]);
  return <TopbarContext.Provider value={value}>{children}</TopbarContext.Provider>;
}

export function useTopbar(): TopbarState {
  const ctx = useContext(TopbarContext);
  if (!ctx) throw new Error('useTopbar outside TopbarProvider');
  return ctx;
}

/** Registers the search placeholder for the current page and returns the typed query. */
export function usePageSearch(placeholder: string): string {
  const { configure, setQuery, query } = useTopbar();
  useEffect(() => {
    configure(placeholder);
    setQuery('');
    return () => {
      configure(null);
      setQuery('');
    };
  }, [placeholder, configure, setQuery]);
  return query;
}

export function useTopbarExtra(node: ReactNode) {
  const { setExtra } = useTopbar();
  useEffect(() => {
    setExtra(node);
  }, [node, setExtra]);
  useEffect(() => () => setExtra(null), [setExtra]);
}
