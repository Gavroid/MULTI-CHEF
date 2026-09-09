'use client';

// PantryDialog — base wrapper around the native <dialog> element.
// Provides overlay + close-on-backdrop-click + a centered card.
// Used by AddPantryItemDialog and EditPantryItemDialog.

import React, { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface PantryDialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Optional footer slot (e.g. action buttons). */
  footer?: ReactNode;
}

export function PantryDialog({
  open,
  title,
  onClose,
  children,
  footer,
}: PantryDialogProps): ReactElement {
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (): void => onClose();
    el.addEventListener('close', handler);
    el.addEventListener('cancel', handler);
    return (): void => {
      el.removeEventListener('close', handler);
      el.removeEventListener('cancel', handler);
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      data-testid="pantry-dialog"
      className="bg-transparent backdrop:bg-black/40 max-w-screen-sm w-[92vw] p-0 m-auto"
      onClick={(e): void => {
        // Close on backdrop click (clicking the dialog element itself
        // when its bounding box equals the viewport).
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="bg-card rounded-lg shadow-lg border border-border overflow-hidden">
        <header className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-heading">{title}</h2>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--color-bg-elevated)]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="p-4">{children}</div>
        {footer ? (
          <footer className="px-4 py-3 border-t border-border bg-[var(--color-bg-elevated)]">
            {footer}
          </footer>
        ) : null}
      </div>
    </dialog>
  );
}
