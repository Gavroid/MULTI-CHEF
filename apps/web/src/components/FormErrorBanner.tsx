// FormErrorBanner — common error display for the auth forms.
//
// Renders a role="alert" block with a danger-toned surface. Used at
// the top of /auth/login and /auth/register when the server returns
// a 4xx envelope or the network fails. Field-level errors stay on
// the individual Input via its `error` prop (Input from packages/ui
// already handles aria-invalid + role=alert).

import React, { type ReactElement } from 'react';
import { cn } from '@multichef/ui';

export function FormErrorBanner({
  message,
  className,
}: {
  message: string | null;
  className?: string;
}): ReactElement {
  if (!message) return <div aria-live="polite" className="sr-only" />;
  return (
    <div
      role="alert"
      data-testid="mc-form-error"
      className={cn(
        'rounded-[var(--radius-md)] border border-[var(--color-danger)]',
        'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
        'px-3 py-2 text-sm',
        className,
      )}
    >
      {message}
    </div>
  );
}
