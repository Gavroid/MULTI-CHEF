// MC-032 — nutritionMatch factor (weight 0.15).
//
// Mean absolute deviation of per-serving macros from the per-meal target
// (dailyTarget / mealsPerDay), normalised: 50% deviation on any macro
// means 0 for that macro (ADR open question #5 default, fixed threshold
// instead of catalog max). No target configured → neutral 1.

import { clamp01 } from '../weights.js';
import type { GenerationContext, Recipe } from '../../types.js';

/** Deviation of 50% from target on a macro → that macro contributes 0. */
const DEVIATION_LIMIT = 0.5;

export function nutritionMatch(recipe: Recipe, ctx: GenerationContext): number {
  const target = ctx.targetDailyMacros;
  if (!target || ctx.mealsPerDay <= 0) return 1;

  const meals = ctx.mealsPerDay;
  const perMeal = {
    kcal: target.calories / meals,
    proteinG: target.proteinG / meals,
    fatG: target.fatG / meals,
    carbsG: target.carbsG / meals,
  };

  const actual = {
    kcal: recipe.nutrition.kcal,
    proteinG: recipe.nutrition.proteinG,
    fatG: recipe.nutrition.fatG,
    carbsG: recipe.nutrition.carbsG,
  };

  const targets = [perMeal.kcal, perMeal.proteinG, perMeal.fatG, perMeal.carbsG];
  const actuals = [actual.kcal, actual.proteinG, actual.fatG, actual.carbsG];

  let deviationSum = 0;
  let counted = 0;
  for (let i = 0; i < targets.length; i += 1) {
    const t = targets[i]!;
    if (t <= 0) continue; // target 0 on a macro → not comparable, skip
    const dev = Math.abs(actuals[i]! - t) / t;
    deviationSum += Math.min(1, dev / DEVIATION_LIMIT);
    counted += 1;
  }

  if (counted === 0) return 1;
  return clamp01(1 - deviationSum / counted);
}
