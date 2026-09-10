// MC-032 — pantryMatch factor tests (edges 0/1, monotonicity, optional).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pantryMatch } from '../../scoring/factors/pantryMatch.js';
import type { GenerationContext, Recipe } from '../../types.js';
import { NOW } from '../fixtures/pantry.js';

const ing = (id: string, grams: number, optional = false) => ({
  ingredientId: id,
  categoryGroup: 'OTHER' as const,
  grams,
  name: id,
  optional,
});

const RECIPE: Recipe = {
  id: 'r',
  title: 'r',
  mealTypes: ['LUNCH'],
  difficulty: 1,
  prepMinutes: 5,
  cookMinutes: 5,
  requiredAppliances: [],
  ingredients: [ing('a', 100), ing('b', 300), ing('c', 100, true)],
  tags: [],
  instructionsText: [],
  leftoverSourceOf: [],
  nutrition: { kcal: 100, proteinG: 5, fatG: 5, carbsG: 10 },
  estimatedExtraCostKopecks: 0,
};

const CTX = (pantry: GenerationContext['pantry']): GenerationContext => ({
  now: NOW,
  pantry,
  preferences: {
    dietType: 'NONE',
    excludeIngredients: [],
    allergies: [],
    appliances: [],
    preferences: [],
  },
  maxMinutes: 60,
  antiFilters: [],
  recentRecipeIds7d: [],
  mealsPerDay: 3,
});

test('pantryMatch: everything covered → 1', () => {
  const value = pantryMatch(
    RECIPE,
    CTX([
      { ingredientId: 'a', estimatedGrams: 150, priority: 'NORMAL' },
      { ingredientId: 'b', estimatedGrams: 300, priority: 'NORMAL' },
    ]),
  );
  assert.equal(value, 1);
});

test('pantryMatch: nothing covered → 0', () => {
  assert.equal(pantryMatch(RECIPE, CTX([])), 0);
});

test('pantryMatch: partial coverage → exact ratio (400/400 required grams)', () => {
  const value = pantryMatch(
    RECIPE,
    CTX([{ ingredientId: 'a', estimatedGrams: 100, priority: 'NORMAL' }]),
  );
  // required = 100 + 300 = 400; covered = 100 → 0.25
  assert.ok(Math.abs(value - 0.25) < 1e-9);
});

test('pantryMatch: stock below required grams does not count', () => {
  const value = pantryMatch(
    RECIPE,
    CTX([{ ingredientId: 'b', estimatedGrams: 299, priority: 'NORMAL' }]),
  );
  assert.equal(value, 0);
});

test('pantryMatch: monotone — adding pantry items never lowers the value', () => {
  const one = pantryMatch(
    RECIPE,
    CTX([{ ingredientId: 'a', estimatedGrams: 100, priority: 'NORMAL' }]),
  );
  const two = pantryMatch(
    RECIPE,
    CTX([
      { ingredientId: 'a', estimatedGrams: 100, priority: 'NORMAL' },
      { ingredientId: 'b', estimatedGrams: 300, priority: 'NORMAL' },
    ]),
  );
  assert.ok(two > one);
});

test('pantryMatch: no required ingredients → 1 (not punished)', () => {
  const empty: Recipe = { ...RECIPE, ingredients: [ing('c', 50, true)] };
  assert.equal(pantryMatch(empty, CTX([])), 1);
});
