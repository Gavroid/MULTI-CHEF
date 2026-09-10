// MC-032 — Hard filter tests: allergy (parameterised), dietType,
// appliances, maxTime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allergyFilter } from '../../filters/allergy.js';
import { dietTypeFilter } from '../../filters/dietType.js';
import { appliancesFilter } from '../../filters/appliances.js';
import { maxTimeFilter } from '../../filters/maxTime.js';
import type { DietType, GenerationContext, Recipe } from '../../types.js';
import { NOW } from '../fixtures/pantry.js';

const ing = (id: string, group: Recipe['ingredients'][number]['categoryGroup']) => ({
  ingredientId: id,
  categoryGroup: group,
  grams: 100,
  name: id,
  optional: false,
});

const RECIPE: Recipe = {
  id: 'r',
  title: 'r',
  mealTypes: ['LUNCH'],
  difficulty: 1,
  prepMinutes: 10,
  cookMinutes: 20,
  requiredAppliances: ['STOVE', 'OVEN'],
  ingredients: [ing('ing_nuts', 'NUTS'), ing('ing_milk', 'DAIRY'), ing('ing_rice', 'GRAIN')],
  tags: [],
  instructionsText: [],
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
    appliances: ['STOVE', 'OVEN'],
    preferences: [],
  },
  maxMinutes: 30,
  antiFilters: [],
  recentRecipeIds7d: [],
  mealsPerDay: 3,
  ...over,
});

// --- allergy (parameterised over exclude kinds) ---

test('allergy: clean recipe passes', () => {
  const ctx = CTX({ preferences: { ...CTX().preferences, allergies: ['ing_shrimp'] } });
  assert.equal(allergyFilter(RECIPE, ctx), true);
});

const BLOCK_CASES: Array<[string, string[]]> = [
  ['allergies', ['ing_nuts']],
  ['excludeIngredients', ['ing_nuts']],
  ['allergies (dairy)', ['ing_milk']],
  ['both lists combined', ['ing_rice']],
];

for (const [label, ids] of BLOCK_CASES) {
  test(`allergy: blocked ingredient in ${label} → ALLERGY rejection`, () => {
    const ctx = CTX({
      preferences: {
        ...CTX().preferences,
        allergies: ids[0] === 'ing_nuts' && label.startsWith('exclude') ? [] : ids,
        excludeIngredients: label.startsWith('exclude') ? ids : [],
      },
    });
    const verdict = allergyFilter(RECIPE, ctx);
    assert.notEqual(verdict, true);
    if (verdict !== true) {
      assert.equal(verdict.reject.code, 'ALLERGY');
      assert.equal(verdict.reject.ingredientId, ids[0]);
    }
  });
}

// --- dietType (parameterised over diets) ---

const DIET_CASES: Array<[DietType, string | null]> = [
  ['NONE', null],
  // Recipe has no MEAT/FISH → VEGETARIAN passes.
  ['VEGETARIAN', null],
  // First banned group in ingredient order for VEGAN is DAIRY (ing_milk).
  ['VEGAN', 'ing_milk'],
  // No MEAT in the recipe → PESCATARIAN passes.
  ['PESCATARIAN', null],
];

for (const [diet, expectedHit] of DIET_CASES) {
  test(`dietType: ${diet} → ${expectedHit ? 'reject' : 'pass'}`, () => {
    const ctx = CTX({ preferences: { ...CTX().preferences, dietType: diet } });
    const verdict = dietTypeFilter(RECIPE, ctx);
    if (expectedHit === null) {
      assert.equal(verdict, true);
    } else {
      assert.notEqual(verdict, true);
      if (verdict !== true) {
        assert.equal(verdict.reject.code, 'DIET_CONFLICT');
        assert.equal(verdict.reject.ingredientId, expectedHit);
      }
    }
  });
}

test('dietType: VEGAN rejects recipe with EGG', () => {
  const ctx = CTX({ preferences: { ...CTX().preferences, dietType: 'VEGAN' } });
  const eggRecipe: Recipe = { ...RECIPE, ingredients: [ing('ing_egg', 'EGG')] };
  const verdict = dietTypeFilter(eggRecipe, ctx);
  assert.notEqual(verdict, true);
  if (verdict !== true && verdict.reject.code === 'DIET_CONFLICT') {
    assert.equal(verdict.reject.ingredientId, 'ing_egg');
  } else {
    assert.fail('expected DIET_CONFLICT');
  }
});

test('dietType: PESCATARIAN rejects MEAT, allows FISH', () => {
  const ctx = CTX({ preferences: { ...CTX().preferences, dietType: 'PESCATARIAN' } });
  const meat: Recipe = { ...RECIPE, ingredients: [ing('ing_pork', 'MEAT')] };
  const fish: Recipe = { ...RECIPE, ingredients: [ing('ing_salmon', 'FISH')] };
  assert.notEqual(dietTypeFilter(meat, ctx), true);
  assert.equal(dietTypeFilter(fish, ctx), true);
});

// --- appliances ---

test('appliances: all required present → pass', () => {
  assert.equal(appliancesFilter(RECIPE, CTX()), true);
});

test('appliances: one missing → APPLIANCE_MISSING with the appliance', () => {
  const ctx = CTX({ preferences: { ...CTX().preferences, appliances: ['STOVE'] } });
  const verdict = appliancesFilter(RECIPE, ctx);
  assert.notEqual(verdict, true);
  if (verdict !== true) {
    assert.equal(verdict.reject.code, 'APPLIANCE_MISSING');
    assert.equal(verdict.reject.appliance, 'OVEN');
  }
});

test('appliances: recipe without appliances always passes', () => {
  const ctx = CTX({ preferences: { ...CTX().preferences, appliances: [] } });
  const noAppliance: Recipe = { ...RECIPE, requiredAppliances: [] };
  assert.equal(appliancesFilter(noAppliance, ctx), true);
});

// --- maxTime ---

test('maxTime: equal boundary → pass', () => {
  assert.equal(maxTimeFilter(RECIPE, CTX({ maxMinutes: 30 })), true);
});

test('maxTime: one minute over → EXCEEDS_TIME', () => {
  const verdict = maxTimeFilter(RECIPE, CTX({ maxMinutes: 29 }));
  assert.notEqual(verdict, true);
  if (verdict !== true) {
    assert.equal(verdict.reject.code, 'EXCEEDS_TIME');
    assert.equal(verdict.reject.required, 30);
    assert.equal(verdict.reject.max, 29);
  }
});

test('maxTime: zero-minute recipe passes any budget', () => {
  const fast: Recipe = { ...RECIPE, prepMinutes: 0, cookMinutes: 0 };
  assert.equal(maxTimeFilter(fast, CTX({ maxMinutes: 0 })), true);
});
