import { useEffect, useState, useSyncExternalStore } from 'react';
import { acquireDraftSync, peekDraftSync, releaseDraftSync, type DraftSync, type DraftSyncState } from '../store/draftSync';

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
    const onFocus = () => s.refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      releaseDraftSync(s);
    };
  }, [draftId, branchId]);

  // A bill that is already loaded shows from the first frame, before the effect above runs.
  const live = sync && sync.id === draftId ? sync : draftId && branchId ? peekDraftSync(draftId) : null;
  const state = useSyncExternalStore(live ? live.subscribe : noopSubscribe, live ? live.getState : emptySnapshot);
  return { sync: live, state: live ? state : EMPTY };
}
