// MC-030 — computeRecipeNutrition: the core deterministic algorithm.
//
// Pure function: (servings, ingredient lines with per-serving nutrition)
// → total + per-serving facts + explicit warnings. Missing/invalid data
// never fails the computation and is never silently dropped — it lands
// in `warnings` instead.

import { roundNutrition } from './rounding.js';
import type { IngredientWithQuantity, NutritionFacts } from './types.js';
import type { NutritionWarning } from './warnings.js';

export type ComputeInput = {
  servings: number;
  ingredients: IngredientWithQuantity[];
};

export type ComputeResult = {
  total: NutritionFacts;
  perServing: NutritionFacts;
  warnings: NutritionWarning[];
};

const ZERO_FACTS: NutritionFacts = { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 };

function addFacts(a: NutritionFacts, b: NutritionFacts): NutritionFacts {
  return {
    kcal: a.kcal + b.kcal,
    proteinG: a.proteinG + b.proteinG,
    fatG: a.fatG + b.fatG,
    carbsG: a.carbsG + b.carbsG,
  };
}

function scaleFacts(facts: NutritionFacts, factor: number): NutritionFacts {
  return {
    kcal: facts.kcal * factor,
    proteinG: facts.proteinG * factor,
    fatG: facts.fatG * factor,
    carbsG: facts.carbsG * factor,
  };
}

/**
 * Sum the dish nutrition over all ingredient lines.
 *
 * - `quantityG < 0`  → NEGATIVE_QUANTITY warning, line skipped.
 * - `quantityG === 0` → INGREDIENT_QUANTITY_ZERO warning, line skipped.
 * - `ingredientNutrition === null` → MISSING_INGREDIENT_NUTRITION warning;
 *   impact reflects the line's share of the total known dish weight
 *   (>10% → 'high', >2% → 'medium', else 'low'). Line contributes no kcal.
 * - Otherwise → scale per-serving facts by `quantityG / servingSizeG`.
 *
 * `servings` outside [1, +∞) yields SERVINGS_INVALID and falls back to 1
 * (per-serving then equals total, no division by zero).
 */
export function computeRecipeNutrition(input: ComputeInput): ComputeResult {
  const warnings: NutritionWarning[] = [];

  let servings = input.servings;
  if (!Number.isFinite(servings) || servings < 1) {
    warnings.push({ code: 'SERVINGS_INVALID', value: input.servings });
    servings = 1;
  }

  // First pass: known dish weight (for MISSING impact estimation).
  let knownWeightG = 0;
  for (const line of input.ingredients) {
    if (line.quantityG > 0) knownWeightG += line.quantityG;
  }

  let total = ZERO_FACTS;
  for (const line of input.ingredients) {
    if (line.quantityG < 0) {
      warnings.push({ code: 'NEGATIVE_QUANTITY', ingredientName: line.canonicalName });
      continue;
    }
    if (line.quantityG === 0) {
      warnings.push({ code: 'INGREDIENT_QUANTITY_ZERO', ingredientName: line.canonicalName });
      continue;
    }
    const nutrition = line.ingredientNutrition;
    if (
      nutrition === null ||
      nutrition === undefined ||
      !Number.isFinite(nutrition.servingSizeG) ||
      nutrition.servingSizeG <= 0
    ) {
      const ratio = knownWeightG > 0 ? line.quantityG / knownWeightG : 1;
      const impact: 'low' | 'medium' | 'high' =
        ratio > 0.1 ? 'high' : ratio > 0.02 ? 'medium' : 'low';
      warnings.push({
        code: 'MISSING_INGREDIENT_NUTRITION',
        ingredientName: line.canonicalName,
        impact,
      });
      continue;
    }
    const perServingFacts: NutritionFacts = {
      kcal: nutrition.servingCalories,
      proteinG: nutrition.servingProteinG,
      fatG: nutrition.servingFatG,
      carbsG: nutrition.servingCarbsG,
    };
    total = addFacts(total, scaleFacts(perServingFacts, line.quantityG / nutrition.servingSizeG));
  }

  return {
    total: roundNutrition(total),
    perServing: roundNutrition(scaleFacts(total, 1 / servings)),
    warnings,
  };
}
