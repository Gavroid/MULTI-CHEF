// MC-032 — varietyScore factor (weight 0.05).
//
// 1 − frequency of this recipe in the last 7 days of plans:
//   frequency = timesCooked / max(1, totalRecipesPlanned7d).
// Empty history → 1.0 (novelty is free).

import { clamp01 } from '../weights.js';
import type { GenerationContext, Recipe } from '../../types.js';

export function varietyScore(recipe: Recipe, ctx: GenerationContext): number {
  const total = ctx.recentRecipeIds7d.length;
  if (total === 0) return 1;

  const timesCooked = ctx.recentRecipeIds7d.filter((id) => id === recipe.id).length;
  const frequency = timesCooked / Math.max(1, total);
  return clamp01(1 - frequency);
}
