'use client';

// Greeting — time-of-day greeting for /today (MC-034, PRD §2.3.2).
// Client component: hour comes from the browser clock; SSR and CSR
// could disagree (red flag #10) so we render after hydration with a
// stable useState initializer.

import React, { useState } from 'react';
import { Moon, Sun, Sunset } from 'lucide-react';

export function greetingForHour(hour: number): { text: string; Icon: typeof Sun } {
  if (hour < 12) return { text: 'Доброе утро', Icon: Sun };
  if (hour < 18) return { text: 'Добрый день', Icon: Sunset };
  return { text: 'Добрый вечер', Icon: Moon };
}

export interface GreetingProps {
  /** Injected for deterministic tests; defaults to the browser clock. */
  now?: Date;
  name?: string;
}

export function Greeting({ now, name }: GreetingProps): React.ReactElement {
  // Audit round-4 (React #418): SSR renders with the server clock while
  // the client would re-render with its own — a guaranteed hydration
  // mismatch. The browser hour is resolved AFTER mount (tests inject
  // `now` and stay synchronous/SSR-safe).
  const [hour, setHour] = useState<number | null>(() =>
    now ? (now ?? new Date()).getHours() : null,
  );
  React.useEffect(() => {
    if (hour === null) setHour(new Date().getHours());
  }, [hour]);
  const resolved = greetingForHour(hour ?? 12);
  const { text, Icon } = hour === null ? { text: 'Привет', Icon: Sun } : resolved;
  return (
    <div className="mb-4 flex items-center gap-2" data-testid="greeting">
      <Icon size={20} className="text-[var(--color-primary)]" aria-hidden />
      <h1 className="text-xl font-bold text-[var(--color-text)]">
        {text}
        {name ? `, ${name}` : ''}
      </h1>
    </div>
  );
}
