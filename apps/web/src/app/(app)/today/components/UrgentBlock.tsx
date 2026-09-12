'use client';

// UrgentBlock — top pantry items about to expire (MC-034, PRD §2.3.2).
// Shows at most 3 items with expiresAt ≤ today+3 days, soonest first.
// Hidden entirely when nothing is urgent (or the list is empty).

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Card } from '@multichef/ui';

export interface UrgentItem {
  id: string;
  name: string;
  /** ISO date (YYYY-MM-DD) or null. */
  expiresAt: string | null;
}

/** Urgency window: expiresAt ≤ today + 3 days (PRD §2.3.2). */
export const URGENT_WINDOW_DAYS = 3;

export function selectUrgentItems(
  items: UrgentItem[],
  now: Date = new Date(),
): UrgentItem[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const limit = new Date(today);
  limit.setDate(limit.getDate() + URGENT_WINDOW_DAYS);
  return items
    .filter((item) => item.expiresAt !== null)
    .filter((item) => {
      const d = new Date(`${item.expiresAt as string}T00:00:00`);
      return d <= limit;
    })
    .sort((a, b) => (a.expiresAt as string).localeCompare(b.expiresAt as string))
    .slice(0, 3);
}

export interface UrgentBlockProps {
  items: UrgentItem[];
  /** Injected for deterministic tests. */
  now?: Date;
}

export function UrgentBlock({ items, now }: UrgentBlockProps): React.ReactElement | null {
  const urgent = selectUrgentItems(items, now);
  if (urgent.length === 0) return null;
  return (
    <Card className="mb-4 border-[var(--color-warning)]" data-testid="urgent-block">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-warning)]">
        <AlertTriangle size={16} aria-hidden />
        Срочно использовать
      </p>
      <ul className="flex flex-col gap-1" data-testid="urgent-list">
        {urgent.map((item) => (
          <li key={item.id} className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-text)]">{item.name}</span>
            <span className="text-xs text-[var(--color-text-muted)]">{item.expiresAt}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
