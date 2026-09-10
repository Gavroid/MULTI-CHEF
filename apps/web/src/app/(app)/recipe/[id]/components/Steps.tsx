'use client';

// Steps — the «Шаги» tab (MC-035). Renders instruction steps with
// optional timer badges; an empty/broken instructions array renders an
// empty-state line instead of crashing (red flag #4).

import React from 'react';
import { Timer } from 'lucide-react';
import type { RecipeDetail } from '@/lib/recipe-client';

export interface StepsProps {
  recipe: RecipeDetail;
}

export function Steps({ recipe }: StepsProps): React.ReactElement {
  if (recipe.instructions.length === 0) {
    return (
      <p
        className="py-6 text-center text-sm text-[var(--color-text-muted)]"
        data-testid="steps-empty"
      >
        Для этого рецепта пока нет шагов.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3" data-testid="steps-list">
      {recipe.instructions.map((step) => (
        <li
          key={step.order}
          className="flex gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-soft)] text-xs font-semibold text-[var(--color-primary)]">
            {step.order}
          </span>
          <span className="flex-1 text-sm text-[var(--color-text)]">{step.text}</span>
          {step.timerMinutes ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-[var(--color-text-muted)]">
              <Timer size={14} aria-hidden /> {step.timerMinutes} мин
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
