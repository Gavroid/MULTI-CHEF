// MC-030 — Public types of @multichef/nutrition.
//
// The package is deterministic and pure: no I/O, no clock, no randomness.
// Prisma Decimal values must be converted to `number` at the CALLER's
// boundary (e.g. in the seed runner or an API service) — this package
// deliberately does not depend on @prisma/client.

/** Macro facts for a dish, a meal, or a day. kcal is a number (rounded by the caller via roundNutrition). */
export type NutritionFacts = {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
};

/**
 * Per-serving nutrition of ONE ingredient, as stored in
 * IngredientNutrition / RecipeNutrition (schema.prisma is the source of
 * truth; Decimal columns arrive here already converted to number).
 *
 * `servingSizeG` says how many grams one serving of the ingredient is:
 * 100 g of tomato with servingSizeG 100 and servingCalories 18 → 18 kcal.
 */
export type IngredientNutrition = {
  servingSizeG: number;
  servingCalories: number;
  servingProteinG: number;
  servingFatG: number;
  servingCarbsG: number;
};

/** One recipe line: an ingredient, its grams in the dish, and its per-serving nutrition (null if unknown). */
export type IngredientWithQuantity = {
  canonicalName: string;
  /** Grams of this ingredient in the dish. */
  quantityG: number;
  /** null → the ingredient is counted as unknown (see MISSING_INGREDIENT_NUTRITION warning). */
  ingredientNutrition: IngredientNutrition | null;
};

/** Where the per-serving numbers came from (mirrors IngredientNutrition.source). */
export type NutritionSource = 'USDA' | 'OFFICIAL' | 'INTERNAL' | (string & {});
