// MC-030 — Scaling and combining nutrition facts.
//
// scaleNutrition rescales TOTAL dish facts to a new serving count.
// combineNutrition sums several meals into a day plan and reports
// per-day totals plus a per-meal breakdown.

import { roundNutrition } from './rounding.js';
import type { NutritionFacts } from './types.js';

const ZERO_FACTS: NutritionFacts = { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 };

function scaleFacts(facts: NutritionFacts, factor: number): NutritionFacts {
  return {
    kcal: facts.kcal * factor,
    proteinG: facts.proteinG * factor,
    fatG: facts.fatG * factor,
    carbsG: facts.carbsG * factor,
  };
}

function addFacts(a: NutritionFacts, b: NutritionFacts): NutritionFacts {
  return {
    kcal: a.kcal + b.kcal,
    proteinG: a.proteinG + b.proteinG,
    fatG: a.fatG + b.fatG,
    carbsG: a.carbsG + b.carbsG,
  };
}

export type ScaledNutrition = {
  /** Facts rescaled to `targetServings` (total dish size changes). */
  total: NutritionFacts;
  /** Unchanged per-serving facts — scaling multiplies the dish, not the portion. */
  perServing: NutritionFacts;
};

/**
 * Rescale a dish from its current serving count to `targetServings`.
 * Total grows/shrinks proportionally; per-serving facts stay the same.
 */
export function scaleNutrition(
  original: { total: NutritionFacts; perServing: NutritionFacts; currentServings: number },
  targetServings: number,
): ScaledNutrition {
  const factor = targetServings / original.currentServings;
  return {
    total: roundNutrition(scaleFacts(original.total, factor)),
    perServing: roundNutrition(original.perServing),
  };
}

export type CombinedNutrition = {
  /** Day total: every meal summed (NOT divided by meal count). */
  total: NutritionFacts;
  /** Per-meal breakdown in input order. */
  byMeal: NutritionFacts[];
};

/**
 * Combine several meals into a day plan. Returns the summed day total
 * and the per-meal breakdown; both rounded by the PRD convention.
 */
export function combineNutrition(meals: NutritionFacts[]): CombinedNutrition {
  let total = ZERO_FACTS;
  const byMeal: NutritionFacts[] = [];
  for (const meal of meals) {
    total = addFacts(total, meal);
    byMeal.push(roundNutrition(meal));
  }
  return { total: roundNutrition(total), byMeal };
}
