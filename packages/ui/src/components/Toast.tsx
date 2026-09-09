// Toast — bottom-anchored, auto-dismissing notification. PRD §2.5.5.
'use client';

// Uses a tiny pub/sub store so any component can call `toast.success(...)`
// without prop-drilling. ToastProvider mounts a single portal that renders
// the active toasts. Queue is single-slot per spec.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '../cn';
export type ToastTone = 'info' | 'success' | 'warning' | 'danger';
export interface ToastInput {
  /** Stable id; if omitted, one is generated. */
  id?: string;
  message: string;
  tone?: ToastTone;
  /** Optional action button label + handler (e.g. "Отменить"). */
  action?: { label: string; onClick: () => void };
  /** Override the default 4s auto-dismiss (PRD §2.5.5). */
  durationMs?: number;
}
interface ToastEntry extends Required<Pick<ToastInput, 'id' | 'message' | 'tone'>> {
  action?: ToastInput['action'];
  durationMs: number;
  enqueuedAt: number;
}
interface ToastContextValue {
  show: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
}
const ToastContext = createContext<ToastContextValue | null>(null);
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return ctx;
}

// Module-level helpers — call from anywhere without the hook.
let externalApi: ToastContextValue | null = null;
export const toast = {
  show(input: ToastInput): string {
    if (!externalApi) {
      // Allow SSR or test contexts where the provider is not mounted: drop
      // the toast silently rather than crashing. UI surfaces always mount
      // ToastProvider at the root.
      return '';
    }
    return externalApi.show(input);
  },
  info(message: string): string {
    return toast.show({ message, tone: 'info' });
  },
  success(message: string): string {
    return toast.show({ message, tone: 'success' });
  },
  warning(message: string): string {
    return toast.show({ message, tone: 'warning' });
  },
  danger(message: string): string {
    return toast.show({ message, tone: 'danger' });
  },
};
let counter = 0;
function genId(): string {
  counter += 1;
  return `toast-${Date.now().toString(36)}-${counter}`;
}
const toneClasses: Record<ToastTone, string> = {
  info: 'bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-info)]',
  success: 'bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-fresh)]',
  warning: 'bg-[var(--color-warning-soft)] text-[var(--color-text)] border-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger-soft)] text-[var(--color-text)] border-[var(--color-danger)]',
};
export function ToastProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [active, setActive] = useState<ToastEntry | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback((id: string): void => {
    setActive((prev) => (prev && prev.id === id ? null : prev));
  }, []);

  const show = useCallback((input: ToastInput): string => {
    const id = input.id ?? genId();
    const entry: ToastEntry = {
      id,
      message: input.message,
      tone: input.tone ?? 'info',
      durationMs: input.durationMs ?? 4000,
      enqueuedAt: Date.now(),
      ...(input.action !== undefined ? { action: input.action } : {}),
    };
    // Single-slot queue — replace whatever is on screen (PRD §2.5.5).
    setActive(entry);
    return id;
  }, []);

  const api = useMemo<ToastContextValue>(() => ({ show, dismiss }), [show, dismiss]);

  // Expose the API to module-level `toast.*` helpers.
  useEffect(() => {
    externalApi = api;
    return (): void => {
      if (externalApi === api) externalApi = null;
    };
  }, [api]);

  // Auto-dismiss timer.
  useEffect(() => {
    if (!active) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setActive(null);
      timerRef.current = null;
    }, active.durationMs);
    return (): void => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [active]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport active={active} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
function ToastViewport({
  active,
  onDismiss,
}: {
  active: ToastEntry | null;
  onDismiss: (id: string) => void;
}): React.ReactElement {
  // No portal — we render in-flow at the end of the provider subtree.
  // Position via `fixed` so it sticks to the bottom-of-viewport regardless
  // of where the provider is mounted. PRD §2.5.5: bottom, above tab-bar.
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 pointer-events-none"
    >
      {active ? (
        <div
          role="status"
          data-testid="mc-toast"
          className={cn(
            'pointer-events-auto',
            'border-l-4 rounded-[var(--radius-md)] shadow-[var(--shadow-card)]',
            'px-4 py-3 min-w-[280px] max-w-[420px]',
            'flex items-center gap-3',
            toneClasses[active.tone],
          )}
        >
          <p className="flex-1 text-sm">{active.message}</p>
          {active.action ? (
            <button
              type="button"
              className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
              onClick={() => {
                active.action?.onClick();
                onDismiss(active.id);
              }}
            >
              {active.action.label}
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Закрыть"
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            onClick={() => onDismiss(active.id)}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
