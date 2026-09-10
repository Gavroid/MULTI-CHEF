// MC-032 — pantryMatch factor (weight 0.25).
//
// Share of REQUIRED (optional=false) ingredient grams already covered by
// the pantry, where coverage needs estimatedGrams >= required grams.
// A recipe with no required ingredients is not punished: value = 1.

import { clamp01 } from '../weights.js';
import type { GenerationContext, Recipe } from '../../types.js';

export function pantryMatch(recipe: Recipe, ctx: GenerationContext): number {
  const pantryGrams = new Map<string, number>();
  for (const item of ctx.pantry) {
    pantryGrams.set(
      item.ingredientId,
      (pantryGrams.get(item.ingredientId) ?? 0) + item.estimatedGrams,
    );
  }

  let requiredTotal = 0;
  let covered = 0;
  for (const ing of recipe.ingredients) {
    if (ing.optional) continue; // ADR open question #4 default: optional never counted.
    requiredTotal += ing.grams;
    if ((pantryGrams.get(ing.ingredientId) ?? 0) >= ing.grams) {
      covered += ing.grams;
    }
  }

  if (requiredTotal === 0) return 1;
  return clamp01(covered / requiredTotal);
}
