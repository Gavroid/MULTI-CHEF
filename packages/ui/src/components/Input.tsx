// Input — text field with label, helper, and error states.
'use client';

// PRD §2.5.4: h-12, radius-md, focus ring primary-soft, error border danger.
import React, { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '../cn';
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helper?: string;
  error?: string;
}
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, helper, error, id, className, ...rest },
  ref,
) {
  const reactId = useId();
  const fieldId = id ?? `mc-input-${reactId}`;
  const helperId = helper ? `${fieldId}-helper` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [helperId, errorId].filter(Boolean).join(' ') || undefined;
  const hasError = Boolean(error);

  return (
    <div className="flex flex-col gap-1">
      {label ? (
        <label htmlFor={fieldId} className="text-sm font-medium text-[var(--color-text)]">
          {label}
        </label>
      ) : null}
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy}
        className={cn(
          'h-12 px-3 rounded-[var(--radius-md)] text-base',
          'bg-[var(--color-surface)] text-[var(--color-text)]',
          'border focus:outline-none transition-shadow duration-[120ms]',
          hasError
            ? 'border-[var(--color-danger)] focus:shadow-[0_0_0_3px_var(--color-danger-soft)]'
            : 'border-[var(--color-border)] focus:border-[var(--color-primary)] focus:shadow-[0_0_0_3px_var(--color-primary-soft)]',
          'disabled:opacity-45 disabled:cursor-not-allowed',
          className,
        )}
        {...rest}
      />
      {helper && !hasError ? (
        <p id={helperId} className="text-xs text-[var(--color-text-muted)]">
          {helper}
        </p>
      ) : null}
      {hasError ? (
        <p id={errorId} role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
});
