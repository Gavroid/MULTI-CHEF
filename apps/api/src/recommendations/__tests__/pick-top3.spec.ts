// MC-033 — Unit tests for pickTop3 (all three types, fallbacks).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTop3, countMissingIngredients, type TodayOption } from '../pick-top3.js';
import type { ScoredRecipe, GenerationContext, Recipe } from '@multichef/recommendation';
import type { RecipeRowWithRelations } from '../../recipes/recipes.service.js';

const NOW = new Date('2026-09-10T10:00:00Z');

function makeRecipe(id: string, opts?: { chainTags?: string[] }): Recipe {
  return {
    id,
    title: `Title ${id}`,
    mealTypes: ['LUNCH'],
    difficulty: 1,
    prepMinutes: 10,
    cookMinutes: 20,
    requiredAppliances: ['STOVE'],
    ingredients: [
      { ingredientId: 'a', categoryGroup: 'GRAIN', grams: 100, name: 'a', optional: false },
      { ingredientId: 'b', categoryGroup: 'VEGETABLE', grams: 100, name: 'b', optional: false },
      { ingredientId: 'c', categoryGroup: 'DAIRY', grams: 100, name: 'c', optional: false },
    ],
    tags: [],
    instructionsText: ['готовить'],
    leftoverSourceOf: [],
    chainTags: opts?.chainTags ?? [],
    nutrition: { kcal: 400, proteinG: 20, fatG: 10, carbsG: 50 },
    estimatedExtraCostKopecks: 0,
  };
}

function makeScored(
  id: string,
  score: number,
  pantryMatch: number,
  chainTags: string[] = [],
): ScoredRecipe {
  return {
    recipe: makeRecipe(id, { chainTags }),
    score,
    passed: true,
    breakdown: {
      pantryMatch: { value: pantryMatch, weight: 0.25, contribution: pantryMatch * 0.25 },
      expirationBenefit: { value: 0, weight: 0.2, contribution: 0 },
      budgetMatch: { value: 0, weight: 0.15, contribution: 0 },
      nutritionMatch: { value: 0, weight: 0.15, contribution: 0 },
      timeMatch: { value: 0, weight: 0.1, contribution: 0 },
      preferenceMatch: { value: 0.5, weight: 0.1, contribution: 0.05 },
      varietyScore: { value: 0, weight: 0.05, contribution: 0 },
    },
  };
}

const CTX: GenerationContext = {
  now: NOW,
  pantry: [{ ingredientId: 'a', estimatedGrams: 500, priority: 'NORMAL' }],
  preferences: {
    dietType: 'NONE',
    excludeIngredients: [],
    allergies: [],
    appliances: ['STOVE'],
    preferences: [],
  },
  maxMinutes: 60,
  antiFilters: [],
  recentRecipeIds7d: [],
  mealsPerDay: 3,
};

function makeDeps(scored: ScoredRecipe[]): Parameters<typeof pickTop3>[2] {
  const rowById = new Map<string, RecipeRowWithRelations>();
  for (const s of scored) {
    rowById.set(s.recipe.id, { id: s.recipe.id } as unknown as RecipeRowWithRelations);
  }
  return {
    toRecipeDto: (row) =>
      ({ id: row.id }) as unknown as ReturnType<Parameters<typeof pickTop3>[2]['toRecipeDto']>,
    rowById,
  };
}

const explain = (
  s: ScoredRecipe,
  extra?: { toBuyCount?: number; chainTag?: string | null; noChains?: boolean },
) =>
  `explain ${s.recipe.id}${extra?.noChains ? ' no-chains' : ''}${extra?.chainTag ? ` chain ${extra.chainTag}` : ''}`;

test('pickTop3: returns exactly 3 options in order FROM_PANTRY, BEST_MATCH, CHAIN', () => {
  const scored = [
    makeScored('r1', 0.9, 1.0, ['c1']),
    makeScored('r2', 0.8, 0.5, ['c1']),
    makeScored('r3', 0.7, 0.0, ['c2']),
    makeScored('r4', 0.6, 0.0, ['c2']),
  ];
  const options: TodayOption[] = pickTop3(scored, CTX, makeDeps(scored), explain);
  assert.equal(options.length, 3);
  assert.deepEqual(
    options.map((o) => o.type),
    ['FROM_PANTRY', 'BEST_MATCH', 'CHAIN'],
  );
});

test('pickTop3: FROM_PANTRY picks best pantryMatch with toBuyCount <= 2', () => {
  const scored = [makeScored('r_full', 0.5, 1.0), makeScored('r_low', 0.9, 0.1)];
  const [fromPantry] = pickTop3(scored, CTX, makeDeps(scored), explain);
  assert.ok(fromPantry);
  assert.equal(fromPantry!.type, 'FROM_PANTRY');
  if (fromPantry!.type === 'FROM_PANTRY') {
    assert.equal(fromPantry!.recipe.id, 'r_full');
    assert.equal(fromPantry!.toBuyCount, 2); // b and c missing
    assert.equal(fromPantry!.chainTag, null);
  } else {
    assert.fail('expected FROM_PANTRY');
  }
});

test('pickTop3: BEST_MATCH excludes the FROM_PANTRY recipe', () => {
  const scored = [
    makeScored('r1', 0.9, 1.0),
    makeScored('r2', 0.8, 0.4),
    makeScored('r3', 0.7, 0.4),
  ];
  const options = pickTop3(scored, CTX, makeDeps(scored), explain);
  const best = options[1]!;
  assert.equal(best.type, 'BEST_MATCH');
  if (best.type === 'BEST_MATCH') {
    assert.equal(best.recipe.id, 'r2');
    assert.ok(best.score > 0);
  }
});

test('pickTop3: CHAIN picks best eligible 2..4 cluster (used recipes excluded first)', () => {
  // FROM_PANTRY takes a1 (best pantryMatch); BEST_MATCH takes c1 (top
  // score excluding a1). soup-week loses c1 → size 1, not eligible.
  // other-week (both unused) wins: avg (0.65+0.6)/2 = 0.625.
  const scored = [
    makeScored('a1', 0.5, 1.0),
    makeScored('c1', 0.8, 0, ['soup-week']),
    makeScored('c2', 0.6, 0, ['soup-week']),
    makeScored('d1', 0.65, 0, ['other-week']),
    makeScored('d2', 0.6, 0, ['other-week']),
  ];
  const options = pickTop3(scored, CTX, makeDeps(scored), explain);
  const chain = options[2]!;
  assert.equal(chain.type, 'CHAIN');
  if (chain.type === 'CHAIN') {
    assert.equal(chain.chainTag, 'other-week');
    assert.equal(chain.recipe.id, 'd1');
    assert.equal(chain.chain.length, 1);
    assert.equal(chain.chain[0]!.id, 'd2');
    assert.match(chain.explanation, /chain other-week/);
  } else {
    assert.fail('expected CHAIN');
  }
});

test('pickTop3: no chain clusters → CHAIN fallback with chainTag null + explanation', () => {
  const scored = [makeScored('r1', 0.9, 1.0), makeScored('r2', 0.8, 0.5)];
  const options = pickTop3(scored, CTX, makeDeps(scored), explain);
  const chain = options[2]!;
  assert.equal(chain.type, 'CHAIN');
  if (chain.type === 'CHAIN') {
    assert.equal(chain.chainTag, null);
    assert.deepEqual(chain.chain, []);
    assert.match(chain.explanation, /no-chains/);
  }
});

test('pickTop3: cluster of 5 is NOT eligible (max 4)', () => {
  // p1 is FROM_PANTRY; BEST_MATCH takes e1 → big loses e1 (size 4,
  // still eligible!). To force ineligibility by size, use 6 entries:
  // losing one leaves 5 > 4 → not eligible.
  const scored = [
    makeScored('p1', 0.5, 1.0),
    makeScored('e1', 0.95, 0, ['big']),
    makeScored('e2', 0.9, 0, ['big']),
    makeScored('e3', 0.85, 0, ['big']),
    makeScored('e4', 0.8, 0, ['big']),
    makeScored('e5', 0.75, 0, ['big']),
    makeScored('e6', 0.7, 0, ['big']),
  ];
  const options = pickTop3(scored, CTX, makeDeps(scored), explain);
  const chain = options[2]!;
  assert.equal(chain.type, 'CHAIN');
  if (chain.type === 'CHAIN') {
    // 6 - e1(BEST_MATCH) = 5 remaining > 4 → fallback
    assert.equal(chain.chainTag, null);
  } else {
    assert.fail('expected CHAIN');
  }
});

test('pickTop3: empty pantry → FROM_PANTRY falls back to least-missing', () => {
  const emptyCtx: GenerationContext = { ...CTX, pantry: [] };
  const scored = [makeScored('r1', 0.9, 0), makeScored('r2', 0.8, 0)];
  const [fromPantry] = pickTop3(scored, emptyCtx, makeDeps(scored), explain);
  assert.ok(fromPantry);
  assert.equal(fromPantry!.type, 'FROM_PANTRY');
  if (fromPantry!.type === 'FROM_PANTRY') {
    // 3 required ingredients, none in pantry → toBuyCount 3
    assert.equal(fromPantry!.toBuyCount, 3);
  }
});

test('pickTop3: ties broken by id (deterministic output)', () => {
  const scored = [makeScored('b2', 0.5, 1.0), makeScored('a1', 0.5, 1.0)];
  const options1 = pickTop3(scored, CTX, makeDeps(scored), explain);
  const options2 = pickTop3(scored, CTX, makeDeps(scored), explain);
  assert.deepEqual(options1, options2);
});

test('countMissingIngredients: optional ingredients never counted', () => {
  const recipe = makeRecipe('r');
  recipe.ingredients = [
    { ingredientId: 'a', categoryGroup: 'GRAIN', grams: 100, name: 'a', optional: false },
    { ingredientId: 'z', categoryGroup: 'SPICE', grams: 5, name: 'z', optional: true },
  ];
  assert.equal(countMissingIngredients(recipe, CTX), 0);
});
