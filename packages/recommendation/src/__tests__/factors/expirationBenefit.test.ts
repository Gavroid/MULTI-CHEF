// MC-032 — expirationBenefit factor tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expirationBenefit } from '../../scoring/factors/expirationBenefit.js';
import type { GenerationContext, Recipe } from '../../types.js';
import { NOW } from '../fixtures/pantry.js';

const DAY = 24 * 60 * 60 * 1000;

const ing = (id: string, grams: number) => ({
  ingredientId: id,
  categoryGroup: 'OTHER' as const,
  grams,
  name: id,
  optional: false,
});

const RECIPE: Recipe = {
  id: 'r',
  title: 'r',
  mealTypes: ['LUNCH'],
  difficulty: 1,
  prepMinutes: 5,
  cookMinutes: 5,
  requiredAppliances: [],
  ingredients: [ing('tomato', 200), ing('pasta', 200)],
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

test('expirationBenefit: empty pantry → 0', () => {
  assert.equal(expirationBenefit(RECIPE, CTX([])), 0);
});

test('expirationBenefit: nothing urgent → 0 (far expiry, NORMAL priority)', () => {
  const value = expirationBenefit(
    RECIPE,
    CTX([
      {
        ingredientId: 'tomato',
        estimatedGrams: 300,
        priority: 'NORMAL',
        expiresAt: new Date(NOW.getTime() + 30 * DAY),
      },
    ]),
  );
  assert.equal(value, 0);
});

test('expirationBenefit: expiring within 3 days counts', () => {
  const value = expirationBenefit(
    RECIPE,
    CTX([
      {
        ingredientId: 'tomato',
        estimatedGrams: 200,
        priority: 'NORMAL',
        expiresAt: new Date(NOW.getTime() + 3 * DAY),
      },
    ]),
  );
  // urgent used = 200 of 400 required → 0.5
  assert.ok(Math.abs(value - 0.5) < 1e-9);
});

test('expirationBenefit: USE_FIRST counts even with far/no expiry', () => {
  const value = expirationBenefit(
    RECIPE,
    CTX([
      {
        ingredientId: 'tomato',
        estimatedGrams: 100,
        priority: 'USE_FIRST',
        expiresAt: new Date(NOW.getTime() + 365 * DAY),
      },
    ]),
  );
  assert.ok(Math.abs(value - 0.25) < 1e-9);
});

test('expirationBenefit: urgent grams capped at required grams', () => {
  const value = expirationBenefit(
    RECIPE,
    CTX([{ ingredientId: 'tomato', estimatedGrams: 10000, priority: 'USE_FIRST' }]),
  );
  assert.ok(Math.abs(value - 0.5) < 1e-9);
});

test('expirationBenefit: urgent item not used by the recipe → 0', () => {
  const value = expirationBenefit(
    RECIPE,
    CTX([{ ingredientId: 'cheese', estimatedGrams: 500, priority: 'USE_FIRST' }]),
  );
  assert.equal(value, 0);
});

test('expirationBenefit: boundary — exactly 3 days + 1 ms → not urgent', () => {
  const value = expirationBenefit(
    RECIPE,
    CTX([
      {
        ingredientId: 'tomato',
        estimatedGrams: 200,
        priority: 'NORMAL',
        expiresAt: new Date(NOW.getTime() + 3 * DAY + 1),
      },
    ]),
  );
  assert.equal(value, 0);
});
