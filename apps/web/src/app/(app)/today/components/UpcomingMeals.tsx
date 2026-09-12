'use client';

// UpcomingMeals — nearest entries from the active meal plan (MC-034).
// Hidden entirely when activePlan is null (red flag #9: the
// /meal-plans/active endpoint arrives with MC-051; a 404 must degrade
// to "no plan", never a crash).

import React from 'react';
import { CalendarClock } from 'lucide-react';
import { Card } from '@multichef/ui';

export interface UpcomingMeal {
  recipeId: string;
  title: string;
  /** ISO date (YYYY-MM-DD). */
  scheduledFor: string;
}

export interface UpcomingMealsProps {
  activePlan: { entries: UpcomingMeal[] } | null;
}

export function UpcomingMeals({ activePlan }: UpcomingMealsProps): React.ReactElement | null {
  if (!activePlan || activePlan.entries.length === 0) return null;
  const nearest = [...activePlan.entries]
    .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
    .slice(0, 3);
  return (
    <Card className="mb-4" data-testid="upcoming-meals">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
        <CalendarClock size={16} className="text-[var(--color-primary)]" aria-hidden />
        Ближайшие приёмы пищи
      </p>
      <ul className="flex flex-col gap-1">
        {nearest.map((meal) => (
          <li
            key={`${meal.recipeId}-${meal.scheduledFor}`}
            className="flex items-center justify-between text-sm"
          >
            <span className="text-[var(--color-text)]">{meal.title}</span>
            <span className="text-xs text-[var(--color-text-muted)]">{meal.scheduledFor}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
