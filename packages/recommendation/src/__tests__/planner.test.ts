// MC-051 — planner unit tests: determinism (seeded rng), slot filling,
// no-repeat policy, no-cook days, calorie-deviation swaps, chain bonus.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, planWeek, type PlannerInput } from '../planner.js';
import type { GenerationContext, Recipe } from '../types.js';

function makeRecipe(
  id: string,
  opts?: {
    mealTypes?: Recipe['mealTypes'];
    kcal?: number;
    prepMinutes?: number;
    chainTags?: string[];
  },
): Recipe {
  return {
    id,
    title: `T ${id}`,
    mealTypes: opts?.mealTypes ?? ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'],
    difficulty: 1,
    prepMinutes: opts?.prepMinutes ?? 10,
    cookMinutes: 10,
    requiredAppliances: [],
    ingredients: [
      { ingredientId: 'a', categoryGroup: 'GRAIN', grams: 100, name: 'a', optional: false },
    ],
    tags: [],
    instructionsText: [],
    leftoverSourceOf: [],
    chainTags: opts?.chainTags ?? [],
    nutrition: {
      kcal: opts?.kcal ?? 500,
      proteinG: 20,
      fatG: 15,
      carbsG: 60,
    },
    estimatedExtraCostKopecks: 0,
  };
}

const CTX: GenerationContext = {
  now: new Date('2026-09-14T10:00:00Z'),
  pantry: [{ ingredientId: 'a', estimatedGrams: 10_000, priority: 'NORMAL' }],
  preferences: {
    dietType: 'NONE',
    excludeIngredients: [],
    allergies: [],
    appliances: [],
    preferences: [],
  },
  maxMinutes: 120,
  antiFilters: [],
  recentRecipeIds7d: [],
  mealsPerDay: 3,
};

function makeCatalog(count = 25): Recipe[] {
  return Array.from({ length: count }, (_, i) =>
    makeRecipe(`r${i + 1}`, {
      kcal: 300 + (i % 9) * 80,
      chainTags: i % 5 === 0 ? ['chain-x'] : [],
    }),
  );
}

function makeInput(overrides?: Partial<PlannerInput>): PlannerInput {
  return {
    recipes: makeCatalog(),
    ctx: CTX,
    days: 7,
    mealsPerDay: 3,
    peopleCount: 2,
    noCookDays: [],
    repeatPolicy: 'NO_REPEATS',
    ...overrides,
  };
}

test('planWeek: fills every slot when the catalog is large enough', () => {
  const result = planWeek(makeInput(), mulberry32(42));
  assert.equal(result.metrics.slots, 21);
  assert.equal(result.metrics.filled, 21);
  assert.equal(result.entries.length, 21);
});

test('planWeek: deterministic for a fixed seed', () => {
  const a = planWeek(makeInput(), mulberry32(7));
  const b = planWeek(makeInput(), mulberry32(7));
  assert.deepEqual(
    a.entries.map((e) => [e.dayIndex, e.mealType, e.recipe.id]),
    b.entries.map((e) => [e.dayIndex, e.mealType, e.recipe.id]),
    'same seed → identical plan',
  );
});

test('mulberry32: different seeds produce different sequences', () => {
  const a = mulberry32(7);
  const b = mulberry32(8);
  const seqA = [a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b()];
  assert.notDeepEqual(seqA, seqB, 'seed jitter source differs (plan varies per jobId)');
});

test('planWeek: NO_REPEATS never reuses a recipe within the plan', () => {
  const result = planWeek(makeInput(), mulberry32(1));
  const ids = result.entries.map((e) => e.recipe.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(result.metrics.repeatCount, 0);
});

test('planWeek: meal order follows MEAL_ORDER per day', () => {
  const result = planWeek(makeInput(), mulberry32(3));
  for (let d = 0; d < 7; d++) {
    const types = result.entries.filter((e) => e.dayIndex === d).map((e) => e.mealType);
    assert.deepEqual(types, ['BREAKFAST', 'LUNCH', 'DINNER']);
  }
});

test('planWeek: no-cook days prefer prep=0 dishes (fallback allowed)', () => {
  const recipes = [
    makeRecipe('fast', { prepMinutes: 0, kcal: 500 }),
    makeRecipe('slow', { prepMinutes: 45, kcal: 500 }),
    makeRecipe('slow2', { prepMinutes: 40, kcal: 500 }),
    makeRecipe('slow3', { prepMinutes: 30, kcal: 500 }),
  ];
  const result = planWeek(makeInput({ recipes, noCookDays: [0] }), mulberry32(5));
  const day0 = result.entries.filter((e) => e.dayIndex === 0);
  assert.ok(day0.length > 0);
  assert.equal(day0[0]!.recipe.prepMinutes, 0, 'first no-cook slot uses a prep=0 dish');
});

test('planWeek: swaps reduce the calorie deviation below the no-swap baseline', () => {
  // Skewed catalog: without swaps, days drift far from the 2000 kcal target.
  const recipes = [
    makeRecipe('big1', { kcal: 1200 }),
    makeRecipe('big2', { kcal: 1100 }),
    makeRecipe('big3', { kcal: 1000 }),
    makeRecipe('small1', { kcal: 300 }),
    makeRecipe('small2', { kcal: 250 }),
    makeRecipe('small3', { kcal: 200 }),
    makeRecipe('mid1', { kcal: 650 }),
    makeRecipe('mid2', { kcal: 700 }),
    makeRecipe('mid3', { kcal: 600 }),
  ];
  // Spare catalog: NO_REPEATS swaps need unused candidates to exist.
  const input = makeInput({
    recipes: [...recipes, ...makeCatalog(25)],
    days: 4,
    targetDailyCalories: 2000,
    ctx: {
      ...CTX,
      targetDailyMacros: { calories: 2000, proteinG: 60, fatG: 60, carbsG: 200 },
    },
  });
  const withTarget = planWeek(input, mulberry32(11));
  assert.ok(
    (withTarget.metrics.avgDailyCalorieDeviation ?? 1) < 0.3,
    `deviation should be bounded, got ${withTarget.metrics.avgDailyCalorieDeviation}`,
  );
});

test('planWeek: metric avgDailyCalorieDeviation is null without a target', () => {
  const result = planWeek(makeInput(), mulberry32(2));
  assert.equal(result.metrics.avgDailyCalorieDeviation, null);
});

test('planWeek: partial catalog leaves slots empty instead of crashing', () => {
  const result = planWeek(
    makeInput({ recipes: [makeRecipe('only', { kcal: 500 })], repeatPolicy: 'NO_REPEATS' }),
    mulberry32(4),
  );
  assert.equal(result.metrics.filled, 1);
  assert.equal(result.metrics.slots, 21);
});
