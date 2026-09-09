// MC-030 — Public API of @multichef/nutrition.
//
// Deterministic nutrition math for MULTI-CHEF. Pure functions only:
// no I/O, no clock, no randomness. Prisma Decimal → number conversion
// happens at the caller's boundary.

export { computeRecipeNutrition } from './compute.js';
export type { ComputeInput, ComputeResult } from './compute.js';
export { scaleNutrition, combineNutrition } from './scale.js';
export type { ScaledNutrition, CombinedNutrition } from './scale.js';
export { roundNutrition, roundKcal, roundMacro } from './rounding.js';
export type {
  NutritionFacts,
  IngredientWithQuantity,
  IngredientNutrition,
  NutritionSource,
} from './types.js';
export type { NutritionWarning, NutritionWarningCode } from './warnings.js';
