'use client';

// IngredientList — the «Ингредиенты» tab: scaled ingredient lines with
// the read-only «есть дома» checkboxes (MC-035). Presentational; all
// state arrives via props.

import React from 'react';
import { Check } from 'lucide-react';
import { Skeleton } from '@multichef/ui';
import { formatMacro, type RecipeDetail, type RecipeIngredientLine } from '@/lib/recipe-client';

export interface IngredientListProps {
  recipe: RecipeDetail;
  factor: number;
  checked: Set<string>;
  pantryLoading: boolean;
  pantryError: string | null;
  onToggle: (ingredientId: string) => void;
}

export function IngredientList({
  recipe,
  factor,
  checked,
  pantryLoading,
  pantryError,
  onToggle,
}: IngredientListProps): React.ReactElement {
  return (
    <div data-testid="ingredient-list">
      {pantryError ? (
        <p
          className="mb-3 rounded-[var(--radius-sm)] bg-[var(--color-warning-soft)] px-3 py-2 text-xs text-[var(--color-warning)]"
          data-testid="pantry-error-banner"
        >
          Не удалось загрузить холодильник — сверка «есть дома» недоступна.
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {recipe.ingredients.map((line) => {
          const grams = Math.round(line.grams * factor);
          const isChecked = checked.has(line.ingredientId);
          const checkboxLabel = isChecked
            ? `${line.canonicalName}: есть дома`
            : `${line.canonicalName}: нет дома`;
          return (
            <li
              key={line.ingredientId}
              className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2"
              data-testid={`ingredient-row-${line.ingredientId}`}
            >
              {pantryLoading ? (
                <Skeleton className="h-5 w-5 rounded-sm" data-testid="pantry-check-skeleton" />
              ) : (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isChecked}
                  aria-label={checkboxLabel}
                  data-testid={`ingredient-check-${line.ingredientId}`}
                  onClick={() => onToggle(line.ingredientId)}
                  className={
                    isChecked
                      ? 'flex h-5 w-5 items-center justify-center rounded-sm bg-[var(--color-fresh)] text-white'
                      : 'flex h-5 w-5 items-center justify-center rounded-sm border border-[var(--color-border)] bg-transparent'
                  }
                >
                  {isChecked ? <Check size={14} aria-hidden /> : null}
                </button>
              )}
              <span className="flex-1 text-sm text-[var(--color-text)]">
                {line.canonicalName}
                {line.optional ? (
                  <span className="ml-1 text-xs text-[var(--color-text-muted)]">(по вкусу)</span>
                ) : null}
              </span>
              <span className="text-sm font-medium tabular-nums text-[var(--color-text)]">
                {formatMacro(grams)} г
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Helper re-exported for tests: the seeded checked-set for a recipe. */
export function defaultCheckedIds(
  recipeLines: RecipeIngredientLine[],
  covered: Set<string>,
): Set<string> {
  return new Set(
    recipeLines.filter((line) => covered.has(line.ingredientId)).map((l) => l.ingredientId),
  );
}
