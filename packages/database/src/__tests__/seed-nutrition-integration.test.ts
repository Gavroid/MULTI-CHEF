// MC-INGREDIENT-NUTRITION — integration tests (real Postgres).
//
// Run with `RUN_DB_INTEGRATION=1 INTEGRATION_DATABASE_URL=... pnpm test:integration`.
// Assumes stages 1-5 ran (fresh DB → run `pnpm db:seed` first; these tests
// also invoke the stage functions directly, they are idempotent).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { computeRecipeNutrition } from '@multichef/nutrition';
import { seedIngredientNutrition, recomputeRecipeNutrition } from '../seed/nutrition/index.js';

let prisma: PrismaClient | undefined;

before(async () => {
  if (!process.env['RUN_DB_INTEGRATION']) return;
  const url = process.env['INTEGRATION_DATABASE_URL'];
  if (!url) throw new Error('INTEGRATION_DATABASE_URL is required for integration tests');
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
});

after(async () => {
  if (prisma) await prisma.$disconnect();
});

function db(): PrismaClient {
  if (!prisma) throw new Error('integration setup did not initialise prisma');
  return prisma;
}

test('nutrition seed: coverage of distinct recipe ingredients is >= 90%', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) return t.skip('RUN_DB_INTEGRATION not set');

  const stage6 = await seedIngredientNutrition(db());
  // Data completeness: the mapping is total today — surface gaps loudly.
  assert.deepEqual(stage6.unresolved, [], `unmapped ingredients: ${stage6.unresolved.join(', ')}`);

  const rows = await db().$queryRaw<Array<{ total: bigint; resolved: bigint }>>`
    SELECT
      COUNT(DISTINCT ri."ingredientId")::bigint AS total,
      COUNT(DISTINCT ri."ingredientId") FILTER (WHERE inn."ingredientId" IS NOT NULL)::bigint AS resolved
    FROM "RecipeIngredient" ri
    LEFT JOIN "IngredientNutrition" inn ON inn."ingredientId" = ri."ingredientId"`;
  const { total, resolved } = rows[0]!;
  const coverage = Number(resolved) / Number(total);
  assert.ok(
    coverage >= 0.9,
    `coverage ${(coverage * 100).toFixed(1)}% (${resolved}/${total}) is below 90%`,
  );
});

test('nutrition seed: RecipeNutrition matches computeRecipeNutrition for every recipe', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) return t.skip('RUN_DB_INTEGRATION not set');

  await recomputeRecipeNutrition(db());

  const recipes = await db().recipe.findMany({
    select: {
      id: true,
      servings: true,
      nutrition: { select: { servingCalories: true, calculationVersion: true } },
      ingredients: {
        select: {
          grams: true,
          ingredient: {
            select: {
              canonicalName: true,
              nutrition: {
                select: {
                  caloriesPer100g: true,
                  proteinPer100g: true,
                  fatPer100g: true,
                  carbsPer100g: true,
                },
              },
            },
          },
        },
      },
    },
  });
  assert.ok(recipes.length >= 200, `expected >=200 recipes, got ${recipes.length}`);

  let checked = 0;
  for (const recipe of recipes) {
    const result = computeRecipeNutrition({
      servings: recipe.servings,
      ingredients: recipe.ingredients.map((ri) => ({
        canonicalName: ri.ingredient.canonicalName,
        quantityG: ri.grams.toNumber(),
        ingredientNutrition:
          ri.ingredient.nutrition === null
            ? null
            : {
                servingSizeG: 100,
                servingCalories: ri.ingredient.nutrition.caloriesPer100g.toNumber(),
                servingProteinG: ri.ingredient.nutrition.proteinPer100g.toNumber(),
                servingFatG: ri.ingredient.nutrition.fatPer100g.toNumber(),
                servingCarbsG: ri.ingredient.nutrition.carbsPer100g.toNumber(),
              },
      })),
    });
    const stored = recipe.nutrition;
    assert.ok(stored, `recipe ${recipe.id} has no RecipeNutrition row`);
    assert.equal(stored.calculationVersion, 2, `recipe ${recipe.id} not recomputed (version)`);
    // Per-serving kcal must agree exactly (same package, same inputs).
    assert.equal(
      stored.servingCalories.toNumber(),
      result.perServing.kcal,
      `kcal mismatch for recipe ${recipe.id}`,
    );
    // Realism guard: near-zero kcal is legitimate ONLY for water-based
    // beverages ( americano = water + 18 g coffee ≈ 0.4 kcal ). Every other
    // category must produce a meaningful energy value.
    const isBeverage = recipe.ingredients.length > 0 && stored.servingCalories.toNumber() < 1;
    if (!isBeverage) {
      assert.ok(result.perServing.kcal > 0, `recipe ${recipe.id} computed 0 kcal`);
    } else {
      assert.ok(
        result.total.kcal < 5,
        `recipe ${recipe.id}: sub-1-kcal serving but total ${result.total.kcal} kcal`,
      );
    }
    checked += 1;
  }
  assert.ok(checked >= 200, `only ${checked} recipes verified`);
});
