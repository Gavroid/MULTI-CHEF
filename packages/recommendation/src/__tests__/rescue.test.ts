// MC-040 — rescue tests: rankRescue, noveltyScore factor, must-contain
// filtering, weight-override drift guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankRescue, scoreRecipe, FACTOR_WEIGHTS, RESCUE_FACTOR_WEIGHTS } from '../index.js';
import { noveltyScore } from '../scoring/factors/noveltyScore.js';
import type { GenerationContext, Recipe } from '../types.js';

function makeRecipe(overrides: Partial<Recipe> & { id: string }): Recipe {
  return {
    title: `R ${overrides.id}`,
    mealTypes: ['LUNCH'],
    difficulty: 1,
    prepMinutes: 5,
    cookMinutes: 10,
    requiredAppliances: ['STOVE'],
    ingredients: [{ ingredientId: 'tomato', categoryGroup: 'VEGETABLE', grams: 200, name: 'помидор', optional: false }],
    tags: [],
    instructionsText: ['Нарезать'],
    leftoverSourceOf: [],
    nutrition: { kcal: 200, proteinG: 5, fatG: 5, carbsG: 30 },
    estimatedExtraCostKopecks: 0,
    ...overrides,
  };
}

const ctx: GenerationContext = {
  now: new Date('2026-09-11T10:00:00Z'),
  pantry: [{ ingredientId: 'tomato', estimatedGrams: 500, priority: 'USE_FIRST' }],
  preferences: {
    dietType: 'NONE',
    excludeIngredients: [],
    allergies: [],
    appliances: ['STOVE', 'OVEN', 'MICROWAVE'],
    preferences: [],
  },
  maxMinutes: 60,
  antiFilters: [],
  recentRecipeIds7d: [],
  mealsPerDay: 3,
};

test('rescue: mustContain — only recipes with the target ingredient pass', () => {
  const catalog = [
    makeRecipe({ id: 'with_tomato' }),
    makeRecipe({ id: 'no_tomato', ingredients: [{ ingredientId: 'cheese', categoryGroup: 'DAIRY', grams: 100, name: 'сыр', optional: false }] }),
  ];
  const ranked = rankRescue(catalog, ctx, { targetIngredientId: 'tomato' });
  const byId = new Map(ranked.map((s) => [s.recipe.id, s]));
  assert.equal(byId.get('with_tomato')?.passed, true);
  assert.equal(byId.get('no_tomato')?.passed, false);
  assert.equal(byId.get('no_tomato')?.reject?.code, 'NOT_RESCUE_TARGET');
});

test('rescue: rankRescue happy path — passed recipes ranked desc, rescue weights applied', () => {
  const catalog = [
    makeRecipe({ id: 'a', difficulty: 1 }),
    makeRecipe({ id: 'b', difficulty: 3, ingredients: [{ ingredientId: 'tomato', categoryGroup: 'VEGETABLE', grams: 300, name: 'помидор', optional: false }] }),
  ];
  const ranked = rankRescue(catalog, ctx, { targetIngredientId: 'tomato' });
  const passed = ranked.filter((s) => s.passed);
  assert.equal(passed.length, 2);
  for (let i = 1; i < passed.length; i += 1) {
    assert.ok(passed[i - 1]!.score >= passed[i]!.score);
  }
  // Rescue preset forces expirationBenefit weight 0.30 vs default 0.20 —
  // breakdown.weight must reflect the override.
  assert.equal(passed[0]!.breakdown.expirationBenefit.weight, RESCUE_FACTOR_WEIGHTS.expirationBenefit);
});

test('noveltyScore: tag/chain/ingredient bonuses compose and clamp to [0,1]', () => {
  const base = makeRecipe({ id: 'plain' });
  assert.equal(noveltyScore(base, ctx), 0);

  const tagged = makeRecipe({ id: 'tagged', tags: ['необычное'] });
  assert.equal(noveltyScore(tagged, ctx), 0.5);

  const manyIngredients = makeRecipe({
    id: 'many',
    ingredients: Array.from({ length: 9 }, (_, i) => ({
      ingredientId: `i${i}`,
      categoryGroup: 'OTHER' as const,
      grams: 10,
      name: `i${i}`,
      optional: false,
    })),
  });
  assert.equal(noveltyScore(manyIngredients, ctx), 0.3);

  const chained = makeRecipe({ id: 'chained', chainTags: ['soup-week'] });
  assert.equal(noveltyScore(chained, ctx), 0.2);

  const all = makeRecipe({
    id: 'all',
    tags: ['ЭКЗОТИКА'],
    chainTags: ['x'],
    ingredients: Array.from({ length: 12 }, (_, i) => ({
      ingredientId: `j${i}`,
      categoryGroup: 'OTHER' as const,
      grams: 10,
      name: `j${i}`,
      optional: false,
    })),
  });
  assert.equal(noveltyScore(all, ctx), 1); // 0.5 + 0.3 + 0.2 clamped
});

test('rescue: default (non-rescue) scoring unaffected — weights stay FACTOR_WEIGHTS', () => {
  const recipe = makeRecipe({ id: 'r' });
  const plain = scoreRecipe(recipe, ctx);
  assert.equal(plain.breakdown.expirationBenefit.weight, FACTOR_WEIGHTS.expirationBenefit);
  assert.equal(plain.breakdown.varietyScore.weight, 0);
  assert.equal(plain.breakdown.noveltyScore.weight, 0.05);
});

test('rescue: factorWeightsOverride with Σ ≠ 1 throws (drift guard)', () => {
  const recipe = makeRecipe({ id: 'r' });
  assert.throws(
    () => scoreRecipe(recipe, { ...ctx, factorWeightsOverride: { pantryMatch: 0.9 } }),
    /Σ weights/,
  );
});

test('rescue: total score deterministic — same input, same score (1e-9)', () => {
  const catalog = [makeRecipe({ id: 'a' }), makeRecipe({ id: 'b', difficulty: 2 })];
  const r1 = rankRescue([...catalog], ctx, { targetIngredientId: 'tomato' });
  const r2 = rankRescue([...catalog], ctx, { targetIngredientId: 'tomato' });
  for (let i = 0; i < r1.length; i += 1) {
    assert.ok(Math.abs(r1[i]!.score - r2[i]!.score) < 1e-9);
  }
});
