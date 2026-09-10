// recipe-client unit tests (MC-035): fixtures flag, getRecipe deps,
// clampServings, formatMacro, hasIngredientAmount, missingIngredients.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clampServings,
  servingsFactor,
  scaledIngredientGrams,
  formatMacro,
  hasIngredientAmount,
  missingIngredients,
  usesRecipeFixtures,
  type RecipeDetail,
} from '../recipe-client';
import fixtureFile from '../recipe-fixtures.json';

const recipes = (fixtureFile as unknown as { recipes: RecipeDetail[] }).recipes;
const pasta = recipes.find((r) => r.id === 'r_pasta_grib') as RecipeDetail;

/* ---------------- flag ---------------- */

test('usesRecipeFixtures: only the exact string "1" enables fixtures', () => {
  const original = process.env['NEXT_PUBLIC_USE_RECIPE_FIXTURES'];
  try {
    process.env['NEXT_PUBLIC_USE_RECIPE_FIXTURES'] = '1';
    assert.equal(usesRecipeFixtures(), true);
    process.env['NEXT_PUBLIC_USE_RECIPE_FIXTURES'] = '0';
    assert.equal(usesRecipeFixtures(), false);
    process.env['NEXT_PUBLIC_USE_RECIPE_FIXTURES'] = 'true';
    assert.equal(usesRecipeFixtures(), false, 'anything but "1" is off');
    delete process.env['NEXT_PUBLIC_USE_RECIPE_FIXTURES'];
    assert.equal(usesRecipeFixtures(), false, 'unset = off (production default)');
  } finally {
    if (original !== undefined) process.env['NEXT_PUBLIC_USE_RECIPE_FIXTURES'] = original;
  }
});

/* ---------------- clamp + factor ---------------- */

test('clampServings: NaN → 1, bounds clamp, integers pass through', () => {
  assert.equal(clampServings(Number.NaN), 1);
  assert.equal(clampServings(0), 1);
  assert.equal(clampServings(-5), 1);
  assert.equal(clampServings(99), 12);
  assert.equal(clampServings(7), 7);
  assert.equal(clampServings(2.6), 3);
});

test('servingsFactor + scaledIngredientGrams: 2→4 doubles, 4→3 rounds', () => {
  assert.equal(servingsFactor(4, 2), 2);
  assert.equal(scaledIngredientGrams(200, 2), 400);
  // 4→3: factor 0.75 → 280 × 0.75 = 210 exact; 150 × 0.75 = 112.5 → 113
  assert.equal(scaledIngredientGrams(280, 0.75), 210);
  assert.equal(scaledIngredientGrams(150, 0.75), 113);
});

test('formatMacro: integer → plain, fractional → RU comma', () => {
  assert.equal(formatMacro(37), '37');
  assert.equal(formatMacro(85.6), '85,6');
  assert.equal(formatMacro(0.1 + 0.2), '0,3');
});

/* ---------------- pantry coverage ---------------- */

const pantryRow = (
  ingredientId: string,
  estimatedGrams: number,
  archivedAt: string | null = null,
) => ({
  ingredientId,
  estimatedGrams,
  archivedAt,
});

test('hasIngredientAmount: enough → true; not enough → false; archived ignored', () => {
  const pantry = [pantryRow('ing_pasta', 500), pantryRow('ing_cream', 100, '2025-01-01')];
  assert.equal(hasIngredientAmount(pantry, 'ing_pasta', 200), true);
  assert.equal(hasIngredientAmount(pantry, 'ing_pasta', 501), false);
  assert.equal(hasIngredientAmount(pantry, 'ing_cream', 50), false, 'archived rows never count');
  assert.equal(hasIngredientAmount(pantry, 'ing_ghost', 1), false);
});

test('missingIngredients: required unchecked only; optional never missing', () => {
  const checked = new Set(['ing_pasta', 'ing_mushrooms']);
  const missing = missingIngredients(pasta, checked);
  assert.deepEqual(
    missing.map((line) => line.ingredientId),
    ['ing_cream'],
  );
  const noneChecked = missingIngredients(pasta, new Set());
  assert.equal(noneChecked.length, 3, '3 required lines; parsley optional');
});
