// Skeleton — placeholder block with shimmer. Used while content loads.
'use client';

// Respects prefers-reduced-motion via globals.css (animation removed).

import React from 'react';
import { cn } from '../cn';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Tailwind/utility width — defaults to full container width. */
  width?: string;
  /** Tailwind/utility height. */
  height?: string;
  /** Whether to render as a circle (avatar). */
  rounded?: boolean;
}

export function Skeleton({
  width = 'w-full',
  height = 'h-4',
  rounded = false,
  className,
  style,
  ...rest
}: SkeletonProps): React.ReactElement {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        'bg-[var(--color-surface-2)] animate-pulse',
        width,
        height,
        rounded ? 'rounded-full' : 'rounded-[var(--radius-sm)]',
        className,
      )}
      style={style}
      {...rest}
    />
  );
}
