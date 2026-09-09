// MC-031 — Integration tests for the recipe seed stage.
//
// Run with `RUN_DB_INTEGRATION=1 INTEGRATION_DATABASE_URL=... pnpm test:integration`.
// Relies on the earlier stages of the runner (ingredients) having been
// executed by `pnpm db:seed` (see seed-integration.test.ts). These tests
// exercise seedRecipes() against a REAL Postgres.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { RECIPES } from '../seed/recipes/index.js';

let prisma: PrismaClient | undefined;

before(async () => {
  if (!process.env['RUN_DB_INTEGRATION']) return;
  const url = process.env['INTEGRATION_DATABASE_URL'];
  if (!url) {
    throw new Error('INTEGRATION_DATABASE_URL is required for integration tests');
  }
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  // Ensure the catalog stages are present before the recipe stage runs:
  // seedRecipes() resolves Ingredient ids created by stage 2.
  const ingCount = await prisma.ingredient.count();
  if (ingCount === 0) {
    const { execSync } = await import('node:child_process');
    execSync('pnpm db:seed:recipes-only 2>/dev/null || pnpm db:seed', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
  }
});

after(async () => {
  if (prisma) await prisma.$disconnect();
});

function db(): PrismaClient {
  if (!prisma) throw new Error('integration setup did not initialise prisma');
  return prisma;
}

async function runRecipeSeed(): Promise<{
  recipesCreated: number;
  recipesUpdated: number;
  recipeIngredients: number;
  nutrition: number;
  storageRules: number;
}> {
  const { seedRecipes } = await import('../seed/recipes/index.js');
  return seedRecipes(db());
}

test('recipe seed: creates >=200 Recipe, >=600 RecipeIngredient, >=200 RecipeNutrition', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) return t.skip('RUN_DB_INTEGRATION not set');
  await runRecipeSeed();
  const recipes = await db().recipe.count();
  const ings = await db().recipeIngredient.count();
  const nutrition = await db().recipeNutrition.count();
  assert.ok(recipes >= 200, `expected >=200 recipes, got ${recipes}`);
  assert.ok(ings >= 600, `expected >=600 recipe ingredients, got ${ings}`);
  assert.ok(nutrition >= 200, `expected >=200 nutrition rows, got ${nutrition}`);
});

test('recipe seed: every Recipe has at least 1 RecipeIngredient', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) return t.skip('RUN_DB_INTEGRATION not set');
  const orphans = await db().recipe.findMany({
    where: { ingredients: { none: {} } },
    select: { title: true },
    take: 5,
  });
  assert.deepEqual(
    orphans,
    [],
    `recipes without ingredients: ${orphans.map((r) => r.title).join(', ')}`,
  );
});

test('recipe seed: every Recipe has RecipeNutrition (1:1)', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) return t.skip('RUN_DB_INTEGRATION not set');
  const missing = await db().recipe.findMany({
    where: { nutrition: null },
    select: { title: true },
    take: 5,
  });
  assert.deepEqual(
    missing,
    [],
    `recipes without nutrition: ${missing.map((r) => r.title).join(', ')}`,
  );
});

test('recipe seed: is idempotent — second run does not duplicate rows', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) return t.skip('RUN_DB_INTEGRATION not set');
  await runRecipeSeed();
  const first = {
    recipes: await db().recipe.count(),
    ings: await db().recipeIngredient.count(),
    nutrition: await db().recipeNutrition.count(),
  };
  const second = await runRecipeSeed();
  const after = {
    recipes: await db().recipe.count(),
    ings: await db().recipeIngredient.count(),
    nutrition: await db().recipeNutrition.count(),
  };
  assert.equal(after.recipes, first.recipes, 'recipe count must be stable');
  assert.equal(after.ings, first.ings, 'recipe ingredient count must be stable');
  assert.equal(after.nutrition, first.nutrition, 'nutrition count must be stable');
  assert.ok(second.recipesCreated === 0, 'second run should update, not create');
  assert.ok(second.recipesUpdated === RECIPES.length);
});

test('recipe seed: chain tags are queryable via Recipe.chainTags', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) return t.skip('RUN_DB_INTEGRATION not set');
  // Find a chain with >=2 recipes in the catalog data.
  const chain = RECIPES.filter((r) => (r.leftoverSourceOf?.length ?? 0) >= 2);
  assert.ok(chain.length > 0, 'catalog must contain chained recipes');
  const sampleTitle = chain[0]!.canonicalTitle;
  const sample = await db().recipe.findFirst({
    where: { title: sampleTitle },
    select: { title: true, chainTags: true, leftoverSourceOf: true },
  });
  assert.ok(sample, `recipe "${sampleTitle}" not found in DB`);
  // chainTags non-empty for a member of any CHAIN_TAG; leftoverSourceOf holds recipe-level links.
  const hasChainTag = sample.chainTags.length > 0;
  const hasLeftover = sample.leftoverSourceOf.length > 0;
  assert.ok(
    hasChainTag || hasLeftover,
    `"${sampleTitle}" has neither chainTags nor leftoverSourceOf`,
  );
});

test('recipe seed: Recipe -> RecipeIngredient -> Ingredient join works', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) return t.skip('RUN_DB_INTEGRATION not set');
  const rows = await db().recipeIngredient.findMany({
    where: { recipe: { title: 'Борщ украинский' } },
    include: { ingredient: { select: { canonicalName: true } } },
    take: 20,
  });
  assert.ok(rows.length >= 3, `borsch has only ${rows.length} ingredients`);
  for (const row of rows) {
    assert.ok(row.ingredient.canonicalName.length > 0, 'ingredient join returned empty name');
    assert.ok(row.grams.toNumber() > 0, 'grams must be positive');
  }
});
