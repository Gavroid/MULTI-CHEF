// MC-032 — Public scoring API: scoreRecipe, rank.
//
// scoreRecipe computes the 7-factor weighted score for ONE recipe.
// rank = applyHardFilters + scoring, sorted desc by score, rejected
// recipes included with passed=false and their rejection reason so the
// caller can explain what was filtered out and why.

import { FACTOR_NAMES, FACTOR_WEIGHTS, clamp01, type FactorName } from './weights.js';
import { pantryMatch } from './factors/pantryMatch.js';
import { expirationBenefit } from './factors/expirationBenefit.js';
import { budgetMatch } from './factors/budgetMatch.js';
import { nutritionMatch } from './factors/nutritionMatch.js';
import { timeMatch } from './factors/timeMatch.js';
import { preferenceMatch } from './factors/preferenceMatch.js';
import { varietyScore } from './factors/varietyScore.js';
import { noveltyScore } from './factors/noveltyScore.js';
import { applyHardFilters } from '../filters/index.js';
import type {
  FactorContribution,
  GenerationContext,
  Recipe,
  ScoreBreakdown,
  ScoredRecipe,
} from '../types.js';

const FACTOR_FN: Record<FactorName, (recipe: Recipe, ctx: GenerationContext) => number> = {
  pantryMatch,
  expirationBenefit,
  budgetMatch,
  nutritionMatch,
  timeMatch,
  preferenceMatch,
  varietyScore,
  noveltyScore,
};

/** Σ of effective weights must equal 1 within this epsilon. */
const WEIGHT_SUM_EPSILON = 1e-9;

/** Effective weights for a context: FACTOR_WEIGHTS merged with ctx override. */
function effectiveWeights(ctx: GenerationContext): Record<FactorName, number> {
  const weights = { ...FACTOR_WEIGHTS, ...(ctx.factorWeightsOverride ?? {}) };
  const sum = FACTOR_NAMES.reduce((acc, name) => acc + weights[name], 0);
  if (Math.abs(sum - 1) > WEIGHT_SUM_EPSILON) {
    throw new Error(
      `factorWeightsOverride broken: Σ weights = ${sum.toFixed(12)}, expected 1.0 (±1e-9). ` +
        `Override keys: ${Object.keys(ctx.factorWeightsOverride ?? {}).join(', ') || 'none'}`,
    );
  }
  return weights;
}

/** Compute the weighted 8-factor score of a single recipe (no filtering). */
export function scoreRecipe(recipe: Recipe, ctx: GenerationContext): ScoredRecipe {
  const weights = effectiveWeights(ctx);
  const breakdown = {} as ScoreBreakdown;
  let score = 0;

  for (const name of FACTOR_NAMES) {
    const value = clamp01(FACTOR_FN[name](recipe, ctx));
    const weight = weights[name];
    const contribution: FactorContribution = {
      value,
      weight,
      contribution: value * weight,
    };
    // SAFE: keys of FACTOR_NAMES are exactly the ScoreBreakdown keys.
    (breakdown as Record<FactorName, FactorContribution>)[name] = contribution;
    score += contribution.contribution;
  }

  return { recipe, score, breakdown, passed: true };
}

/**
 * Filter → score → sort for a whole catalog. Rejected recipes come back
 * with passed=false, score=0 and the rejection reason attached.
 */
export function rank(recipes: Recipe[], ctx: GenerationContext): ScoredRecipe[] {
  const { passed, rejected } = applyHardFilters(recipes, ctx);
  const scored = passed.map((recipe) => scoreRecipe(recipe, ctx));
  scored.sort((a, b) => b.score - a.score || a.recipe.id.localeCompare(b.recipe.id));

  const rejectedScored: ScoredRecipe[] = rejected.map(({ recipe, reason }) => ({
    recipe,
    score: 0,
    breakdown: zeroBreakdown(),
    passed: false,
    reject: reason,
  }));

  return [...scored, ...rejectedScored];
}

function zeroBreakdown(): ScoreBreakdown {
  const breakdown = {} as ScoreBreakdown;
  for (const name of FACTOR_NAMES) {
    (breakdown as Record<FactorName, FactorContribution>)[name] = {
      value: 0,
      weight: FACTOR_WEIGHTS[name],
      contribution: 0,
    };
  }
  return breakdown;
}
