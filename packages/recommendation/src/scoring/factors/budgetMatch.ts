// MC-032 — budgetMatch factor (weight 0.15).
//
// 1 − min(1, extraCost / max(1, remainingBudget)). Kopecks are INTEGERS.
// With budgetMode 'NOTHING' the factor turns hard: 0 if anything must be
// bought, 1 when the recipe is fully covered by the pantry.
// No budget info at all (remainingBudget undefined) → neutral 1.

import { clamp01 } from '../weights.js';
import type { GenerationContext, Recipe } from '../../types.js';

export function budgetMatch(recipe: Recipe, ctx: GenerationContext): number {
  const extra = recipe.estimatedExtraCostKopecks;

  if (ctx.budgetMode === 'NOTHING') {
    return extra > 0 ? 0 : 1;
  }

  const remaining = ctx.remainingBudgetKopecks;
  if (remaining === undefined) return 1;

  if (extra === 0) return 1;
  if (remaining <= 0) return 0;

  return clamp01(1 - Math.min(1, extra / Math.max(1, remaining)));
}
