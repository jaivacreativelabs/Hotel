import { CircleCheck, CircleAlert, Info } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { errorMessage } from '../services/api';

type Kind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: Kind;
  message: string;
}
interface ToastApi {
  success: (m: string) => void;
  error: (m: unknown) => void;
  info: (m: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Kind, message: string) => {
    const id = ++seq;
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  const value = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', typeof m === 'string' ? m : errorMessage(m)),
      info: (m) => push('info', m),
    }),
    [push],
  );
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'success' ? <CircleCheck /> : t.kind === 'error' ? <CircleAlert /> : <Info />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}
