// BottomSheet — mobile-first slide-up sheet (PRD §2.5.8). Renders into
'use client';

// a portal so it overlays everything. Closes on backdrop click, Escape,
// or via the `onClose` callback.
//
// We don't pull in a state library — the parent owns `open`. This makes
// the component composable with any router or animation framework.
import React, { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../cn';
export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: ReactNode;
  /** Optional primary action rendered in the sticky footer. */
  primaryAction?: ReactNode;
  /** Aria-label fallback when no title is provided. */
  ariaLabel?: string;
}
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  primaryAction,
  ariaLabel,
}: BottomSheetProps): React.ReactElement | null {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape closes; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return (): void => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const labelledBy = title ? 'mc-bottom-sheet-title' : undefined;

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-end justify-center"
      data-testid="mc-bottom-sheet-root"
    >
      <button
        type="button"
        aria-label="Закрыть"
        tabIndex={-1}
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : (ariaLabel ?? 'Диалог')}
        data-testid="mc-bottom-sheet"
        className={cn(
          'relative w-full max-w-[480px]',
          'bg-[var(--color-surface)] rounded-t-[var(--radius-xl)]',
          'shadow-[var(--shadow-sheet)]',
          'p-4 pb-6',
          'animate-[mc-slide-up_200ms_ease-out]',
        )}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--color-border)]" />
        {title ? (
          <h2
            id="mc-bottom-sheet-title"
            className="mb-3 text-lg font-semibold text-[var(--color-text)]"
          >
            {title}
          </h2>
        ) : null}
        <div className="text-[var(--color-text)]">{children}</div>
        {primaryAction ? <div className="mt-4 flex justify-end gap-2">{primaryAction}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
