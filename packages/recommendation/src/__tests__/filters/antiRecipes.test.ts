// MC-032 — 8 anti-recipe predicates, parameterised (ADR §5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANTI_RECIPE_PREDICATES } from '../../filters/antiRecipes.js';
import type { AntiFilter, GenerationContext, Recipe } from '../../types.js';
import { NOW } from '../fixtures/pantry.js';

const RECIPE: Recipe = {
  id: 'r',
  title: 'r',
  mealTypes: ['LUNCH'],
  difficulty: 1,
  prepMinutes: 10,
  cookMinutes: 20,
  requiredAppliances: ['STOVE'],
  ingredients: [
    {
      ingredientId: 'ing_beef',
      categoryGroup: 'MEAT',
      grams: 300,
      name: 'говядина',
      optional: false,
    },
  ],
  tags: [],
  instructionsText: ['Обжарить мясо', 'Тушить 15 минут'],
  leftoverSourceOf: [],
  nutrition: { kcal: 400, proteinG: 20, fatG: 15, carbsG: 40 },
  estimatedExtraCostKopecks: 0,
};

const CTX = (over: Partial<GenerationContext> = {}): GenerationContext => ({
  now: NOW,
  pantry: [],
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
  ...over,
});

function assertRejected(
  verdict: ReturnType<(typeof ANTI_RECIPE_PREDICATES)['NO_OVEN']>,
  token: AntiFilter,
) {
  assert.notEqual(verdict, true, `expected rejection for ${token}`);
  if (verdict !== true) {
    assert.equal(verdict.reject.code, 'ANTI_RECIPE');
    assert.equal(verdict.reject.antiFilter, token);
  }
}

test('NO_OVEN: rejects OVEN recipe, passes STOVE recipe', () => {
  const oven: Recipe = { ...RECIPE, requiredAppliances: ['OVEN'] };
  assertRejected(ANTI_RECIPE_PREDICATES.NO_OVEN(oven, CTX()), 'NO_OVEN');
  assert.equal(ANTI_RECIPE_PREDICATES.NO_OVEN(RECIPE, CTX()), true);
});

test('ONE_PAN: single STOVE/AIRFRYER/MICROWAVE passes; multi-appliance rejected', () => {
  assert.equal(ANTI_RECIPE_PREDICATES.ONE_PAN(RECIPE, CTX()), true);
  assertRejected(
    ANTI_RECIPE_PREDICATES.ONE_PAN({ ...RECIPE, requiredAppliances: ['STOVE', 'OVEN'] }, CTX()),
    'ONE_PAN',
  );
});

test('ONE_PAN: tag «одна сковорода» passes even with no appliances', () => {
  const tagged: Recipe = { ...RECIPE, requiredAppliances: [], tags: ['одна сковорода'] };
  assert.equal(ANTI_RECIPE_PREDICATES.ONE_PAN(tagged, CTX()), true);
});

test('NOT_CHICKEN_AGAIN: no yesterday signal → no-op (passes chicken)', () => {
  const chicken: Recipe = {
    ...RECIPE,
    ingredients: [
      {
        ingredientId: 'ing_chicken',
        categoryGroup: 'MEAT',
        grams: 300,
        name: 'куриное филе',
        optional: false,
      },
    ],
  };
  assert.equal(ANTI_RECIPE_PREDICATES.NOT_CHICKEN_AGAIN(chicken, CTX()), true);
});

test('NOT_CHICKEN_AGAIN: yesterday chicken → rejects chicken, passes beef', () => {
  const chicken: Recipe = {
    ...RECIPE,
    ingredients: [
      {
        ingredientId: 'ing_chicken',
        categoryGroup: 'MEAT',
        grams: 300,
        name: 'куриное филе',
        optional: false,
      },
    ],
  };
  const beef: Recipe = { ...RECIPE };
  const ctx = CTX({ yesterdayMainProtein: 'CHICKEN' });
  assertRejected(ANTI_RECIPE_PREDICATES.NOT_CHICKEN_AGAIN(chicken, ctx), 'NOT_CHICKEN_AGAIN');
  assert.equal(ANTI_RECIPE_PREDICATES.NOT_CHICKEN_AGAIN(beef, ctx), true);
});

test('NO_LEFTOVERS: chain recipe rejected, standalone passes', () => {
  const chained: Recipe = { ...RECIPE, leftoverSourceOf: ['r_other'] };
  assertRejected(ANTI_RECIPE_PREDICATES.NO_LEFTOVERS(chained, CTX()), 'NO_LEFTOVERS');
  assert.equal(ANTI_RECIPE_PREDICATES.NO_LEFTOVERS(RECIPE, CTX()), true);
});

test('NO_FRYING: fried tag rejected; fried text rejected; clean passes', () => {
  const friedTag: Recipe = { ...RECIPE, tags: ['жареное'], instructionsText: ['Тушить 15 минут'] };
  const friedText: Recipe = { ...RECIPE, tags: [], instructionsText: ['Жарить на масле 5 минут'] };
  const clean: Recipe = { ...RECIPE, tags: [], instructionsText: ['Тушить 15 минут'] };
  assertRejected(ANTI_RECIPE_PREDICATES.NO_FRYING(friedTag, CTX()), 'NO_FRYING');
  assertRejected(ANTI_RECIPE_PREDICATES.NO_FRYING(friedText, CTX()), 'NO_FRYING');
  assert.equal(ANTI_RECIPE_PREDICATES.NO_FRYING(clean, CTX()), true);
});

test('NO_CHOPPING: tag claim + clean text passes; no tag → rejected; chop text overrides claim', () => {
  const clean: Recipe = { ...RECIPE, tags: ['без-нарезки'], instructionsText: ['Всё смешать'] };
  assert.equal(ANTI_RECIPE_PREDICATES.NO_CHOPPING(clean, CTX()), true);

  const noTag: Recipe = { ...RECIPE, tags: [], instructionsText: ['Всё смешать'] };
  assertRejected(ANTI_RECIPE_PREDICATES.NO_CHOPPING(noTag, CTX()), 'NO_CHOPPING');

  const liar: Recipe = { ...RECIPE, tags: ['без-нарезки'], instructionsText: ['Нарезать лук'] };
  assertRejected(ANTI_RECIPE_PREDICATES.NO_CHOPPING(liar, CTX()), 'NO_CHOPPING');
});

test('SHORT_TIME: ≤20 passes (capped by ctx), longer rejected', () => {
  const fast: Recipe = { ...RECIPE, prepMinutes: 5, cookMinutes: 15 };
  const slow: Recipe = { ...RECIPE, prepMinutes: 10, cookMinutes: 20 };
  assert.equal(ANTI_RECIPE_PREDICATES.SHORT_TIME(fast, CTX({ maxMinutes: 60 })), true);
  assertRejected(ANTI_RECIPE_PREDICATES.SHORT_TIME(slow, CTX({ maxMinutes: 60 })), 'SHORT_TIME');
});

test('SHORT_TIME: uses min(maxMinutes, 20) — tighter wins', () => {
  const medium: Recipe = { ...RECIPE, prepMinutes: 5, cookMinutes: 12 }; // 17 min
  const ctx = CTX({ maxMinutes: 15 });
  assertRejected(ANTI_RECIPE_PREDICATES.SHORT_TIME(medium, ctx), 'SHORT_TIME');
});

test('NO_MULTISTEP: ≤3 steps and difficulty ≤2 passes; 4+ steps rejected; difficulty 3 rejected', () => {
  const simple: Recipe = { ...RECIPE, instructionsText: ['a', 'b', 'c'], difficulty: 2 };
  const manySteps: Recipe = { ...RECIPE, instructionsText: ['a', 'b', 'c', 'd'], difficulty: 1 };
  const hard: Recipe = { ...RECIPE, instructionsText: ['a'], difficulty: 3 };
  assert.equal(ANTI_RECIPE_PREDICATES.NO_MULTISTEP(simple, CTX()), true);
  assertRejected(ANTI_RECIPE_PREDICATES.NO_MULTISTEP(manySteps, CTX()), 'NO_MULTISTEP');
  assertRejected(ANTI_RECIPE_PREDICATES.NO_MULTISTEP(hard, CTX()), 'NO_MULTISTEP');
});
