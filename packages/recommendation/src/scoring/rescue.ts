// MC-040 — rankRescue: rescue-mode ranking over a filtered catalog.
//
// Reuses the single `rank()` pipeline with:
//  - ctx.rescue.targetIngredientId → existing rescueFilter (MC-032)
//  - ctx.factorWeightsOverride → RESCUE_FACTOR_WEIGHTS by default
//    (forces expirationBenefit), unless the caller passes its own
//    override.
//
// No I/O, no clock — pure function like the rest of the package.

import { rank } from './index.js';
import { RESCUE_FACTOR_WEIGHTS } from './weights.js';
import type { GenerationContext, Recipe, ScoredRecipe } from '../types.js';

export interface RankRescueOptions {
  /**
   * Hard filter: only recipes containing this ingredient id pass
   * (applied through the existing rescueFilter via ctx.rescue).
   */
  targetIngredientId: string;
  /**
   * Optional caller weights. When omitted, RESCUE_FACTOR_WEIGHTS is
   * used. When given, used AS IS (caller owns the Σ=1.0 invariant —
   * rank() validates and throws on drift).
   */
  factorWeightsOverride?: Partial<Record<string, number>>;
}

/**
 * Rank `recipeCatalog` for rescue mode: rescueFilter must-contain +
 * rescue weights. Returns the full rank() result (passed + rejected).
 */
export function rankRescue(
  recipeCatalog: Recipe[],
  ctx: GenerationContext,
  options: RankRescueOptions,
): ScoredRecipe[] {
  const rescueCtx: GenerationContext = {
    ...ctx,
    rescue: { targetIngredientId: options.targetIngredientId },
    factorWeightsOverride: options.factorWeightsOverride ?? RESCUE_FACTOR_WEIGHTS,
  };
  return rank(recipeCatalog, rescueCtx);
}
