'use client';

// RecipeView — presentational state machine for the recipe page
// (MC-035). Owns the servings stepper, the active tab and the local
// «есть дома» checkbox set; derives all scaled data from props.
//
// Lives next to RecipeClient (which owns the Next.js router plumbing)
// so unit tests can drive the full page state without mocking
// next/navigation (test seam per the repo's TabItem/BottomTabBar
// convention).
//
// servings sync: RecipeClient keeps ?servings=N in the URL via
// router.replace({ scroll: false }) — RecipeView just reports changes
// through onServingsChange.

import React, { useMemo, useState } from 'react';
import { scaleNutrition } from '@multichef/nutrition';
import {
  MAX_SERVINGS,
  MIN_SERVINGS,
  clampServings,
  missingIngredients,
  pantryCoveredIds,
  type RecipeDetail,
} from '@/lib/recipe-client';
import { usePantry, type UsePantryDeps } from '@/hooks/usePantry';
import { Header } from './components/Header';
import { IngredientList } from './components/IngredientList';
import { Steps } from './components/Steps';
import { NutritionTab } from './components/NutritionTab';
import { StorageTab } from './components/StorageTab';
import { AddToPlanButton } from './components/AddToPlanButton';

export const RECIPE_TABS = [
  { id: 'ingredients', label: 'Ингредиенты' },
  { id: 'steps', label: 'Шаги' },
  { id: 'nutrition', label: 'КБЖУ' },
  { id: 'storage', label: 'Хранение' },
] as const;

export type RecipeTabId = (typeof RECIPE_TABS)[number]['id'];

export interface RecipeViewProps {
  recipe: RecipeDetail;
  initialServings?: number;
  initialTab?: RecipeTabId;
  onServingsChange?: (servings: number) => void;
  /** Test seam: override the pantry hook's data source. */
  pantryDeps?: Partial<UsePantryDeps>;
}

export function RecipeView({
  recipe,
  initialServings,
  initialTab,
  onServingsChange,
  pantryDeps,
}: RecipeViewProps): React.ReactElement {
  const baseServings = clampServings(recipe.servings);
  const [servings, setServings] = useState<number>(() =>
    clampServings(initialServings ?? baseServings),
  );
  const [activeTab, setActiveTab] = useState<RecipeTabId>(initialTab ?? 'ingredients');
  const pantry = usePantry(pantryDeps);

  // Local user overrides; null until the first toggle (before that the
  // checkboxes mirror the pantry exactly).
  const [checked, setChecked] = useState<Set<string> | null>(null);

  const factor = servings / baseServings;

  const effectiveChecked = useMemo<Set<string>>(() => {
    if (checked !== null) return checked;
    if (pantry.loading || pantry.error) return new Set<string>();
    return pantryCoveredIds(recipe, factor, pantry.items);
  }, [checked, pantry.loading, pantry.error, pantry.items, recipe, factor]);

  const handleToggle = (ingredientId: string): void => {
    setChecked((prev) => {
      const base = prev ?? effectiveChecked;
      const next = new Set(base);
      if (next.has(ingredientId)) {
        next.delete(ingredientId);
      } else {
        next.add(ingredientId);
      }
      return next;
    });
  };

  const handleServings = (next: number): void => {
    const clamped = clampServings(next);
    setServings(clamped);
    onServingsChange?.(clamped);
  };

  const missing = missingIngredients(recipe, effectiveChecked);
  const nutrition = scaleNutrition(
    {
      total: {
        kcal: recipe.nutrition.servingCalories * baseServings,
        proteinG: recipe.nutrition.servingProteinG * baseServings,
        fatG: recipe.nutrition.servingFatG * baseServings,
        carbsG: recipe.nutrition.servingCarbsG * baseServings,
      },
      perServing: {
        kcal: recipe.nutrition.servingCalories,
        proteinG: recipe.nutrition.servingProteinG,
        fatG: recipe.nutrition.servingFatG,
        carbsG: recipe.nutrition.servingCarbsG,
      },
      currentServings: baseServings,
    },
    servings,
  );

  return (
    <div className="flex min-h-screen flex-col" data-testid="recipe-page">
      <Header
        recipe={recipe}
        servings={servings}
        missing={missing}
        onServingsChange={handleServings}
      />

      <div
        className="mb-3 flex gap-1 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] p-1"
        role="tablist"
        aria-label="Разделы рецепта"
        data-testid="recipe-tabs"
      >
        {RECIPE_TABS.map((tab) => {
          const selected = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={
                selected
                  ? 'flex-1 rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-2 py-2 text-sm font-semibold text-[var(--color-text)]'
                  : 'flex-1 rounded-[var(--radius-sm)] px-2 py-2 text-sm text-[var(--color-text-muted)]'
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1" role="tabpanel" data-testid={`panel-${activeTab}`}>
        {activeTab === 'ingredients' ? (
          <IngredientList
            recipe={recipe}
            factor={factor}
            checked={effectiveChecked}
            pantryLoading={pantry.loading}
            pantryError={pantry.error}
            onToggle={handleToggle}
          />
        ) : null}
        {activeTab === 'steps' ? <Steps recipe={recipe} /> : null}
        {activeTab === 'nutrition' ? (
          <NutritionTab recipe={recipe} total={nutrition.total} servings={servings} />
        ) : null}
        {activeTab === 'storage' ? <StorageTab recipe={recipe} /> : null}
      </div>

      <AddToPlanButton recipeId={recipe.id} servings={servings} />

      {/* Silent guards for the exported range constants — the stepper in
          Header clamps through the same helpers. */}
      <span hidden data-testid="servings-range">
        {MIN_SERVINGS}-{MAX_SERVINGS}
      </span>
    </div>
  );
}
