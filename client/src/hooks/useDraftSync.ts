import { useEffect, useState, useSyncExternalStore } from 'react';
import { acquireDraftSync, releaseDraftSync, type DraftSync, type DraftSyncState } from '../store/draftSync';

const EMPTY: DraftSyncState = { draft: null, local: null, status: 'loading', message: null, dirty: false };
const noopSubscribe = () => () => undefined;
const emptySnapshot = () => EMPTY;

/** Binds a component to the persistent sync engine of one draft. */
export function useDraftSync(draftId: string | null, branchId: string | null) {
  const [sync, setSync] = useState<DraftSync | null>(null);

  useEffect(() => {
    if (!draftId || !branchId) {
      setSync(null);
      return;
    }
    const s = acquireDraftSync(draftId, branchId);
    setSync(s);
    // Pick up changes made by other admins when the tab regains focus.
    const onFocus = () => void s.load();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      releaseDraftSync(s);
    };
  }, [draftId, branchId]);

  const state = useSyncExternalStore(sync ? sync.subscribe : noopSubscribe, sync ? sync.getState : emptySnapshot);
  return { sync: sync && sync.id === draftId ? sync : null, state: sync && sync.id === draftId ? state : EMPTY };
}
