// Chip — selectable pill (PRD §2.5.4 chip-select). Stateless — the parent
'use client';

// owns selection state. Use the `selected` prop + onClick to wire it.

import React from 'react';
import { cn } from '../cn';

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export function Chip({
  selected = false,
  className,
  type = 'button',
  children,
  ...rest
}: ChipProps): React.ReactElement {
  return (
    <button
      type={type}
      aria-pressed={selected}
      data-selected={selected ? '' : undefined}
      className={cn(
        'inline-flex items-center gap-1 min-h-10 px-3.5 rounded-[var(--radius-sm)]',
        'text-sm font-medium select-none transition-colors duration-[120ms]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
        selected
          ? 'bg-[var(--color-primary-soft)] border-[1.5px] border-[var(--color-primary)] text-[var(--color-primary)]'
          : 'bg-[var(--color-surface-2)] border-[1.5px] border-transparent text-[var(--color-text)] hover:bg-[var(--color-surface-2)]/80',
        className,
      )}
      {...rest}
    >
      {selected ? (
        <span aria-hidden="true" className="inline-block">
          ✓
        </span>
      ) : null}
      {children}
    </button>
  );
}
