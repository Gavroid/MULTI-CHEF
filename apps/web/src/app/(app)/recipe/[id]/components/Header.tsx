'use client';

// Header — recipe photo, title, meta row and the servings stepper
// (MC-035). Presentational: all interactivity arrives via props, so the
// component is testable without the Next.js router.

import React, { useState } from 'react';
import { AlertTriangle, BarChart3, ChefHat, Clock, Minus, Plus } from 'lucide-react';
import { Badge } from '@multichef/ui';
import { isSafeRecipeImage, recipeImageUrl } from '@/lib/recipe-image';
import {
  MAX_SERVINGS,
  MIN_SERVINGS,
  type RecipeDetail,
  type RecipeIngredientLine,
} from '@/lib/recipe-client';

export interface HeaderProps {
  recipe: RecipeDetail;
  servings: number;
  missing: RecipeIngredientLine[];
  onServingsChange: (next: number) => void;
  onBack?: () => void;
}

export function Header({
  recipe,
  servings,
  missing,
  onServingsChange,
  onBack,
}: HeaderProps): React.ReactElement {
  const [imageFailed, setImageFailed] = useState(false);
  const totalMinutes = recipe.prepMinutes + recipe.cookMinutes;
  const atMin = servings <= MIN_SERVINGS;
  const atMax = servings >= MAX_SERVINGS;

  return (
    <header className="mb-4" data-testid="recipe-header">
      <div className="relative mb-4 aspect-[4/3] overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] md:aspect-[16/9] lg:aspect-[21/9]">
        {isSafeRecipeImage(recipe.imageKey) && !imageFailed ? (
          // T3: LCP candidate — eager load at high priority, decoded
          // off-thread; the 4/3 aspect wrapper reserves the box (CLS = 0).
          <img
            src={recipeImageUrl(recipe.imageKey) ?? undefined}
            alt={recipe.title}
            className="h-full w-full object-cover"
            loading="eager"
            fetchPriority="high"
            decoding="async"
            onError={() => setImageFailed(true)}
            data-testid="recipe-image"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center bg-[var(--color-surface-2)] text-[var(--color-text-muted)]"
            data-testid="recipe-image-placeholder"
          >
            <ChefHat size={48} aria-hidden />
          </div>
        )}
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Назад"
            className="absolute left-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white"
          >
            <span aria-hidden>←</span>
          </button>
        ) : null}
      </div>

      <h1 className="text-xl font-bold text-[var(--color-text)]" data-testid="recipe-title">
        {recipe.title}
      </h1>
      {recipe.description ? (
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">{recipe.description}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[var(--color-text-muted)]">
        <span className="inline-flex items-center gap-1">
          <Clock size={16} aria-hidden /> {totalMinutes} мин
        </span>
        <span className="inline-flex items-center gap-1">
          <BarChart3 size={16} aria-hidden /> Сложность {recipe.difficulty}/3
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onServingsChange(servings - 1)}
            disabled={atMin}
            aria-label="Уменьшить количество порций"
            data-testid="servings-stepper-minus"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text)] disabled:opacity-40"
          >
            <Minus size={18} aria-hidden />
          </button>
          <span
            className="min-w-[72px] text-center text-base font-semibold text-[var(--color-text)]"
            data-testid="servings-value"
            aria-live="polite"
          >
            {servings} порц.
          </span>
          <button
            type="button"
            onClick={() => onServingsChange(servings + 1)}
            disabled={atMax}
            aria-label="Увеличить количество порций"
            data-testid="servings-stepper-plus"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text)] disabled:opacity-40"
          >
            <Plus size={18} aria-hidden />
          </button>
        </div>

        {missing.length > 0 ? (
          <Badge
            tone="warning"
            data-testid="missing-badge"
            title={`Не хватает: ${missing.map((line) => line.canonicalName).join(', ')}`}
          >
            <AlertTriangle size={12} aria-hidden />
            Не хватает: {missing.length} из {recipe.ingredients.filter((l) => !l.optional).length}
          </Badge>
        ) : null}
      </div>
    </header>
  );
}
