'use client';

// T47-A/B (audit round 47), T67-B (audit round 67): a11y-хук для
// нативного <dialog>: initial focus на первый фокусируемый элемент,
// возврат фокуса на триггер при закрытии. Escape обрабатывает сам
// <dialog> (cancel event). WCAG 2.4.3 focus management.
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogA11y(open: boolean, ref: RefObject<HTMLDialogElement | null>): void {
  const lastFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Запомнить триггер (элемент с фокусом до открытия).
    lastFocused.current = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (el) {
      const target = el.querySelector<HTMLElement>(FOCUSABLE);
      (target ?? el).focus();
    }
    return (): void => {
      // Focus-return на триггер после закрытия.
      lastFocused.current?.focus?.();
    };
  }, [open, ref]);
}
