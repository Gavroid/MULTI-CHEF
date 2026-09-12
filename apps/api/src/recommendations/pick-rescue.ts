// MC-040 — pick-rescue: top-N selection for rescue mode.
//
// Manager decision (manager-product-decisions.md 10:38): sort by
// `score - 0.05 * difficulty` — a mild penalty per difficulty point so
// the top picks are "среди лучших — самые простые" (очевидные →
// необычные), without letting difficulty dominate the score.
//
// Pure function over rank() output: no I/O, no clock.

import type { ScoredRecipe } from '@multichef/recommendation';

/** Score penalty per difficulty point (1..3). Manager decision #2. */
export const DIFFICULTY_PENALTY = 0.05;

export function rescueSortKey(scored: ScoredRecipe): number {
  return scored.score - DIFFICULTY_PENALTY * scored.recipe.difficulty;
}

/** Pick up to `n` passed recipes, obvious-first. */
export function pickRescue(ranked: ScoredRecipe[], n = 3): ScoredRecipe[] {
  return ranked
    .filter((s) => s.passed)
    .sort((a, b) => rescueSortKey(b) - rescueSortKey(a) || a.recipe.id.localeCompare(b.recipe.id))
    .slice(0, n);
}

/**
 * Total grams of `ingredientId` used across the picked recipes.
 * May exceed pantry stock — the UI surfaces «нужно докупить».
 */
export function rescueUsedGrams(picked: ScoredRecipe[], ingredientId: string): number {
  let used = 0;
  for (const s of picked) {
    for (const ing of s.recipe.ingredients) {
      if (ing.ingredientId === ingredientId) used += ing.grams;
    }
  }
  return used;
}
