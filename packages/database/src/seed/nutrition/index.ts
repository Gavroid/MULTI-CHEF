// MC-INGREDIENT-NUTRITION — IngredientNutrition seed stage (stage 6) and
// RecipeNutrition recompute (stage 7).
//
// Stage 6: for every distinct Ingredient used by the MC-031 recipe seed,
// upsert IngredientNutrition from NUTRITION_TABLE via CATALOG_TO_NUTRITION.
// Unmapped ingredients NEVER fail the seed and are never silent: they are
// returned in `unresolved` and logged by the runner.
//
// SCHEMA NOTE (schema.prisma = source of truth; spec diverged): the model
// stores PER-100G facts — caloriesPer100g/proteinPer100g/fatPer100g/
// carbsPer100g + fiberPer100g — and has NO servingSizeG, NO
// sourceUpdatedAt and NO sourceUpdatedAt-like column. `source` is a plain
// String. The seed therefore converts the per-serving catalog table
// (always servingSizeG 100, so values pass through unchanged) and writes
// sourceUpdatedAt into nothing — the info stays in nutrition-data.ts.
//
// Stage 7: recompute every RecipeNutrition row through the deterministic
// @multichef/nutrition package (single source of truth for the math), so
// seeded per-serving facts and the package agree by construction.

import type { PrismaClient } from '@prisma/client';
import { computeRecipeNutrition } from '@multichef/nutrition';
import { NUTRITION_TABLE, type NutritionEntry } from './nutrition-data.js';
import { CATALOG_TO_NUTRITION } from './catalog-mapping.js';

export { NUTRITION_TABLE, CATALOG_TO_NUTRITION };

export type IngredientNutritionSeedResult = {
  resolved: number;
  unresolved: string[];
};

/** Stage 6 — fill IngredientNutrition for ingredients used in recipes. */
export async function seedIngredientNutrition(
  prisma: PrismaClient,
): Promise<IngredientNutritionSeedResult> {
  // Distinct ingredients actually used by seeded recipes (FK-safe).
  const used = await prisma.recipeIngredient.findMany({
    distinct: ['ingredientId'],
    select: { ingredientId: true },
  });

  const ingredients = await prisma.ingredient.findMany({
    where: { id: { in: used.map((u) => u.ingredientId) } },
    select: { id: true, canonicalName: true },
  });

  let resolved = 0;
  const unresolved: string[] = [];

  for (const ing of ingredients) {
    const key = CATALOG_TO_NUTRITION[ing.canonicalName];
    const entry: NutritionEntry | undefined = key ? NUTRITION_TABLE[key] : undefined;
    if (!key || !entry) {
      unresolved.push(ing.canonicalName);
      continue;
    }

    const data = {
      caloriesPer100g: entry.servingCalories,
      proteinPer100g: entry.servingProteinG,
      fatPer100g: entry.servingFatG,
      carbsPer100g: entry.servingCarbsG,
      // Schema requires fiberPer100g; MC-031 table has no fiber data → 0.
      fiberPer100g: 0,
      source: entry.source,
      calculationVersion: 1,
    };

    await prisma.ingredientNutrition.upsert({
      where: { ingredientId: ing.id },
      create: { ingredientId: ing.id, ...data },
      update: data,
    });
    resolved += 1;
  }

  return { resolved, unresolved };
}

export type RecipeNutritionRecomputeResult = {
  recomputed: number;
  skipped: number;
  /** Recipes whose recomputed kcal differs from the stored value by >10%. */
  drift: Array<{ recipeId: string; title: string; oldKcal: number; newKcal: number }>;
};

/**
 * Stage 7 — recompute RecipeNutrition from RecipeIngredient grams +
 * IngredientNutrition via computeRecipeNutrition (MC-030).
 *
 * `servingGrams` gets the dish's per-serving gram weight when known
 * (sum of grams / servings), `calculationVersion` marks the algorithm.
 */
export async function recomputeRecipeNutrition(
  prisma: PrismaClient,
): Promise<RecipeNutritionRecomputeResult> {
  const recipes = await prisma.recipe.findMany({
    select: {
      id: true,
      title: true,
      servings: true,
      nutrition: { select: { recipeId: true, servingCalories: true } },
      ingredients: {
        select: {
          grams: true,
          ingredient: {
            select: { canonicalName: true, nutrition: true },
          },
        },
      },
    },
  });

  let recomputed = 0;
  let skipped = 0;
  const drift: RecipeNutritionRecomputeResult['drift'] = [];

  for (const recipe of recipes) {
    const lines = recipe.ingredients.map((ri) => {
      const n = ri.ingredient.nutrition;
      return {
        canonicalName: ri.ingredient.canonicalName,
        quantityG: ri.grams.toNumber(),
        // IngredientNutrition is per-100g in the schema (servingSizeG is
        // implicit 100; fiber has no counterpart in the MC-030 type).
        ingredientNutrition:
          n === null
            ? null
            : {
                servingSizeG: 100,
                servingCalories: n.caloriesPer100g.toNumber(),
                servingProteinG: n.proteinPer100g.toNumber(),
                servingFatG: n.fatPer100g.toNumber(),
                servingCarbsG: n.carbsPer100g.toNumber(),
              },
      };
    });

    const result = computeRecipeNutrition({ servings: recipe.servings, ingredients: lines });

    const nutritionRow = recipe.nutrition;
    if (!nutritionRow) {
      skipped += 1;
      continue;
    }

    const oldKcal = nutritionRow.servingCalories.toNumber();
    const newKcal = result.perServing.kcal;
    if (oldKcal > 0 && Math.abs(newKcal - oldKcal) / oldKcal > 0.1) {
      drift.push({ recipeId: recipe.id, title: recipe.title, oldKcal, newKcal });
    }

    const totalGrams = lines.reduce((sum, l) => sum + l.quantityG, 0);
    await prisma.recipeNutrition.update({
      where: { recipeId: recipe.id },
      data: {
        servingCalories: newKcal,
        servingProteinG: result.perServing.proteinG,
        servingFatG: result.perServing.fatG,
        servingCarbsG: result.perServing.carbsG,
        servingGrams: Math.round(totalGrams / recipe.servings),
        calculationVersion: 2,
      },
    });
    recomputed += 1;
  }

  return { recomputed, skipped, drift };
}
