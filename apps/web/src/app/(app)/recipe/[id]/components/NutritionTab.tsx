'use client';

// NutritionTab — the «КБЖУ» tab (MC-035). Per-serving facts, the
// scaled dish total, the serving weight and the mandatory §2.5.7
// disclaimer banner at the very top of the tab (must be visible
// without scrolling on a 375×667 iPhone SE viewport).

import React from 'react';
import { Info } from 'lucide-react';
import type { NutritionFacts } from '@multichef/nutrition';
import { formatMacro, type RecipeDetail } from '@/lib/recipe-client';

export interface NutritionTabProps {
  recipe: RecipeDetail;
  /** Scaled dish total at the current servings (already rounded once). */
  total: NutritionFacts;
  /** Servings the total is computed at. */
  servings: number;
}

/** PRD §2.5.7 disclaimer text — verbatim, no paraphrasing. */
export const NUTRITION_DISCLAIMER =
  'Значения КБЖУ ориентировочные: зависят от бренда, фактического веса и способа приготовления. При медицинских ограничениях, беременности и заболеваниях согласуйте рацион с врачом.';

export function NutritionTab({ recipe, total, servings }: NutritionTabProps): React.ReactElement {
  const n = recipe.nutrition;
  return (
    <div data-testid="nutrition-tab">
      <p
        className="mb-3 flex items-start gap-2 rounded-[var(--radius-sm)] bg-[var(--color-info-soft)] px-3 py-2 text-[11px] leading-4 text-[var(--color-info)]"
        data-testid="nutrition-disclaimer"
        role="note"
      >
        <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
        {NUTRITION_DISCLAIMER}
      </p>

      <div className="flex flex-col gap-2">
        <div
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2"
          data-testid="nutrition-per-serving"
        >
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            На 1 порцию (~{formatMacro(n.servingGrams)} г)
          </p>
          <p className="mt-1 text-sm font-semibold text-[var(--color-text)] tabular-nums">
            {formatMacro(n.servingCalories)} ккал · Б {formatMacro(n.servingProteinG)} · Ж{' '}
            {formatMacro(n.servingFatG)} · У {formatMacro(n.servingCarbsG)}
          </p>
        </div>

        <div
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2"
          data-testid="nutrition-total"
        >
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            Всё блюдо — {servings} порц.
          </p>
          <p className="mt-1 text-sm font-semibold text-[var(--color-text)] tabular-nums">
            {formatMacro(total.kcal)} ккал · Б {formatMacro(total.proteinG)} · Ж{' '}
            {formatMacro(total.fatG)} · У {formatMacro(total.carbsG)}
          </p>
        </div>
      </div>

      <p
        className="mt-2 text-[11px] text-[var(--color-text-muted)]"
        data-testid="nutrition-accuracy"
      >
        Расчёт ориентировочный (версия {n.calculationVersion}).
      </p>
    </div>
  );
}
