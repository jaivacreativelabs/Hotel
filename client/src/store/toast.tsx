import { CircleCheck, CircleAlert, Info, Printer, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { errorMessage } from '../services/api';

type Kind = 'success' | 'error' | 'info';
interface Action {
  label: string;
  onClick: () => void;
}
interface Toast {
  id: number;
  kind: Kind;
  message: string;
  action?: Action;
}
export interface ToastApi {
  success: (m: string) => void;
  error: (m: unknown) => void;
  info: (m: string) => void;
  /** A success message with a button (e.g. Print bill) that stays until used or closed. */
  withAction: (m: string, label: string, onClick: () => void) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const remove = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: Kind, message: string, action?: Action) => {
      const id = ++seq;
      // Only one button toast at a time: a new bill's Print replaces the last one.
      setToasts((t) => [...t.filter((x) => !(action && x.action)).slice(-3), { id, kind, message, action }]);
      setTimeout(() => remove(id), action ? 30_000 : kind === 'error' ? 6000 : 3500);
    },
    [remove],
  );
  const value = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', typeof m === 'string' ? m : errorMessage(m)),
      info: (m) => push('info', m),
      withAction: (m, label, onClick) => push('success', m, { label, onClick }),
    }),
    [push],
  );
  return (
    <ToastContext.Provider value={value}>
      {children}
      {[toasts.filter((t) => !t.action), toasts.filter((t) => t.action)].map((list, top) => (
        // Messages with a button go to the top, clear of the bill's payment and Generate buttons.
        <div key={top} className={top ? 'toasts toasts-top' : 'toasts'} role="status" aria-live="polite">
          {list.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`}>
              {t.kind === 'success' ? <CircleCheck /> : t.kind === 'error' ? <CircleAlert /> : <Info />}
              <span>{t.message}</span>
              {t.action && (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary toast-action"
                    onClick={() => {
                      t.action!.onClick();
                      remove(t.id);
                    }}
                  >
                    <Printer /> {t.action.label}
                  </button>
                  <button type="button" className="toast-close" onClick={() => remove(t.id)} aria-label="Close">
                    <X />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      ))}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}
