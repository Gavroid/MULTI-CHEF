// Button — primary CTA primitive. Variants and sizes map to Tailwind
'use client';

// utility classes that reference design tokens (see globals.css).
//
// PRD §2.5.4 component states: default / hover / pressed / disabled / loading.
// Hover/pressed visual handled via :hover/:active CSS (globals.css @layer
// utilities). Loading state disables the button and shows a spinner.
//
// We deliberately render a real <button type="button"> — never a <div> —
// so focus, keyboard, and form semantics are native and free.

import React, { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: string;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-press)] active:scale-[.98]',
  secondary:
    'bg-transparent text-[var(--color-text)] border-[1.5px] border-[var(--color-border)] hover:bg-[var(--color-surface-2)]',
  ghost: 'bg-transparent text-[var(--color-text)] hover:bg-[var(--color-surface-2)]',
  danger: 'bg-[var(--color-danger)] text-white hover:opacity-90 active:scale-[.98]',
};

const sizeClasses: Record<ButtonSize, string> = {
  // PRD §2.5.4: Primary uses h-14 (56px). We expose md=14 by default.
  sm: 'h-10 px-3 text-sm rounded-[var(--radius-md)]',
  md: 'h-14 px-4 text-base font-semibold rounded-[var(--radius-md)]',
  lg: 'h-16 px-6 text-lg font-semibold rounded-[var(--radius-md)]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingText,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isDisabled = disabled === true || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading ? true : undefined}
      data-loading={loading ? '' : undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 select-none',
        'transition-[transform,background-color,opacity] duration-[120ms] ease-out',
        'disabled:opacity-45 disabled:pointer-events-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <>
          <span
            role="img"
            aria-hidden="true"
            className="inline-block w-5 h-5 rounded-full border-2 border-current border-r-transparent animate-spin"
          />
          <span>{loadingText ?? children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
});
