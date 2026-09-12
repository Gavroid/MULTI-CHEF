// MC-040 — Unit tests for pickRescue / rescueUsedGrams.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickRescue, rescueUsedGrams, rescueSortKey, DIFFICULTY_PENALTY } from '../pick-rescue.js';
import type { Recipe, ScoreBreakdown, ScoredRecipe } from '@multichef/recommendation';

function makeRecipe(id: string, opts?: { difficulty?: number; targetGrams?: number }): Recipe {
  return {
    id,
    title: `Title ${id}`,
    mealTypes: ['LUNCH'],
    difficulty: opts?.difficulty ?? 1,
    prepMinutes: 10,
    cookMinutes: 20,
    requiredAppliances: ['STOVE'],
    ingredients: [
      {
        ingredientId: 'target',
        categoryGroup: 'VEGETABLE',
        grams: opts?.targetGrams ?? 100,
        name: 't',
        optional: false,
      },
      { ingredientId: 'b', categoryGroup: 'GRAIN', grams: 100, name: 'b', optional: false },
    ],
    tags: [],
    instructionsText: ['готовить'],
    leftoverSourceOf: [],
    chainTags: [],
    nutrition: { kcal: 400, proteinG: 20, fatG: 10, carbsG: 50 },
    estimatedExtraCostKopecks: 0,
  };
}

function makeScored(
  id: string,
  score: number,
  opts?: { difficulty?: number; passed?: boolean; targetGrams?: number },
): ScoredRecipe {
  const breakdown = {} as ScoreBreakdown;
  for (const name of [
    'pantryMatch',
    'expirationBenefit',
    'budgetMatch',
    'nutritionMatch',
    'timeMatch',
    'preferenceMatch',
    'varietyScore',
    'noveltyScore',
  ] as const) {
    breakdown[name] = { value: 0, weight: 0, contribution: 0 };
  }
  return {
    recipe: makeRecipe(id, opts),
    score,
    passed: opts?.passed ?? true,
    breakdown,
  };
}

test('pickRescue: skips rejected recipes', () => {
  const ranked = [
    makeScored('a', 0.9),
    makeScored('r', 0.95, { passed: false }),
    makeScored('b', 0.8),
  ];
  assert.deepEqual(
    pickRescue(ranked).map((s) => s.recipe.id),
    ['a', 'b'],
  );
});

test('pickRescue: difficulty penalty — simpler recipe wins a score tie', () => {
  const easy = makeScored('easy', 0.8, { difficulty: 1 });
  const hard = makeScored('hard', 0.8, { difficulty: 3 });
  assert.equal(rescueSortKey(easy), 0.8 - DIFFICULTY_PENALTY);
  assert.equal(rescueSortKey(hard), 0.8 - 3 * DIFFICULTY_PENALTY);
  assert.deepEqual(
    pickRescue([hard, easy]).map((s) => s.recipe.id),
    ['easy', 'hard'],
  );
});

test('pickRescue: high score beats difficulty (penalty is mild)', () => {
  const great = makeScored('great', 0.95, { difficulty: 3 });
  const modest = makeScored('modest', 0.8, { difficulty: 1 });
  // 0.95 - 0.15 = 0.80 vs 0.80 - 0.05 = 0.75 → great first.
  assert.deepEqual(pickRescue([modest, great])[0]?.recipe.id, 'great');
});

test('pickRescue: caps at n and ties break by id', () => {
  const ranked = [
    makeScored('c', 0.9),
    makeScored('a', 0.9),
    makeScored('b', 0.9),
    makeScored('d', 0.9),
  ];
  const picked = pickRescue(ranked, 3);
  assert.deepEqual(
    picked.map((s) => s.recipe.id),
    ['a', 'b', 'c'],
  );
});

test('pickRescue: empty passed list → empty pick (service maps to 422)', () => {
  const ranked = [makeScored('a', 0.9, { passed: false })];
  assert.deepEqual(pickRescue(ranked), []);
});

test('rescueUsedGrams: sums grams across picked recipes, per ingredient', () => {
  const picked = [
    makeScored('a', 0.9, { targetGrams: 150 }),
    makeScored('b', 0.8, { targetGrams: 200 }),
  ];
  assert.equal(rescueUsedGrams(picked, 'target'), 350);
  // Both fixtures also carry 100 g of grain 'b' → 100 × 2 recipes.
  assert.equal(rescueUsedGrams(picked, 'b'), 200);
  assert.equal(rescueUsedGrams(picked, 'absent'), 0);
});
