// Badge — small pill, used for tags and metadata (not interactive).
'use client';

// Three semantic tones: fresh / warning / danger — map to PRD §2.5.1.

import React from 'react';
import { cn } from '../cn';

export type BadgeTone = 'fresh' | 'warning' | 'danger' | 'info' | 'neutral';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const toneClasses: Record<BadgeTone, string> = {
  fresh: 'bg-[var(--color-fresh-soft)] text-[var(--color-fresh)]',
  warning: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  info: 'bg-[var(--color-info-soft)] text-[var(--color-info)]',
  neutral: 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
  ...rest
}: BadgeProps): React.ReactElement {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full',
        'text-xs font-medium leading-4',
        toneClasses[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
