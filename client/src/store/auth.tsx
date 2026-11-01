import type { BranchContextDTO, MeDTO, UserDTO } from '@rb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, setApiBranch, setUnauthorizedHandler } from '../services/api';
import { clearSavedQueries } from '../services/savedQueries';
import { forgetDraftSyncs } from './draftSync';

interface AuthState {
  user: UserDTO | null;
  branches: BranchContextDTO[];
  activeBranch: BranchContextDTO | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** One-tap sign-in with a demo account enabled by the Super Admin. */
  demoLogin: (userId: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  selectBranch: (id: string) => void;
}

const AuthContext = createContext<AuthState | null>(null);
const branchKey = (userId: string) => `rb.branch.${userId}`;

function readStoredBranch(userId: string): string | null {
  try {
    return localStorage.getItem(branchKey(userId));
  } catch {
    return null;
  }
}

const pickBranch = (data: MeDTO) => {
  const stored = readStoredBranch(data.user.id);
  return data.branches.find((b) => b.id === stored)?.id ?? data.branches[0]?.id ?? null;
};

/**
 * The signed-in account, kept on the device so the app opens at once after Safari reloads it;
 * /auth/me still checks it in the background and an ended session goes to the login page.
 */
const ME_KEY = 'rb.me';
function readSavedMe(): MeDTO | null {
  try {
    const raw = localStorage.getItem(ME_KEY);
    return raw ? (JSON.parse(raw) as MeDTO) : null;
  } catch {
    return null;
  }
}
function saveMe(data: MeDTO | null) {
  try {
    if (data) localStorage.setItem(ME_KEY, JSON.stringify(data));
    else localStorage.removeItem(ME_KEY);
  } catch {
    /* storage unavailable – the app waits for /auth/me instead */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [saved] = useState(readSavedMe);
  const [me, setMe] = useState<MeDTO | null>(saved);
  const [branchId, setBranchId] = useState<string | null>(() => {
    const chosen = saved ? pickBranch(saved) : null;
    setApiBranch(chosen);
    return chosen;
  });
  const [loading, setLoading] = useState(!saved);

  const apply = useCallback((data: MeDTO | null) => {
    setMe(data);
    saveMe(data);
    if (!data) {
      // Nobody signed in: nothing of the last account stays on the device.
      clearSavedQueries();
      forgetDraftSyncs();
      setBranchId(null);
      setApiBranch(null);
      return;
    }
    const chosen = pickBranch(data);
    setBranchId(chosen);
    setApiBranch(chosen);
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await api.get<MeDTO>('/auth/me'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) apply(null);
      else throw err;
    }
  }, [apply]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      apply(null);
      queryClient.clear();
    });
    refresh()
      // Server out of reach: a remembered account carries on (its requests retry), otherwise sign in.
      .catch(() => !saved && apply(null))
      .finally(() => setLoading(false));
  }, [apply, refresh, queryClient, saved]);

  const value = useMemo<AuthState>(() => {
    const activeBranch = me?.branches.find((b) => b.id === branchId) ?? null;
    return {
      user: me?.user ?? null,
      branches: me?.branches ?? [],
      activeBranch,
      loading,
      login: async (email, password) => {
        queryClient.clear();
        clearSavedQueries();
        apply(await api.post<MeDTO>('/auth/login', { email, password }));
      },
      demoLogin: async (userId) => {
        queryClient.clear();
        clearSavedQueries();
        apply(await api.post<MeDTO>('/auth/demo-login', { userId }));
      },
      logout: async () => {
        await api.post('/auth/logout').catch(() => undefined);
        queryClient.clear();
        apply(null);
      },
      refresh,
      selectBranch: (id) => {
        if (!me) return;
        try {
          localStorage.setItem(branchKey(me.user.id), id);
        } catch {
          /* storage unavailable – selection still applies for this tab */
        }
        setBranchId(id);
        setApiBranch(id);
        queryClient.removeQueries();
      },
    };
  }, [me, branchId, loading, apply, refresh, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
