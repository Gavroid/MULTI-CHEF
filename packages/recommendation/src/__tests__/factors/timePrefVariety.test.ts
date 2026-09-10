// MC-032 — timeMatch / preferenceMatch / varietyScore factor tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeMatch } from '../../scoring/factors/timeMatch.js';
import { preferenceMatch } from '../../scoring/factors/preferenceMatch.js';
import { varietyScore } from '../../scoring/factors/varietyScore.js';
import type { GenerationContext, Recipe } from '../../types.js';
import { NOW } from '../fixtures/pantry.js';

const recipe = (over: Partial<Recipe> = {}): Recipe => ({
  id: 'r_x',
  title: 'r',
  mealTypes: ['LUNCH'],
  difficulty: 1,
  prepMinutes: 10,
  cookMinutes: 20,
  requiredAppliances: [],
  ingredients: [
    { ingredientId: 'a', categoryGroup: 'OTHER', grams: 100, name: 'a', optional: false },
    { ingredientId: 'b', categoryGroup: 'OTHER', grams: 100, name: 'b', optional: false },
  ],
  tags: [],
  instructionsText: [],
  leftoverSourceOf: [],
  nutrition: { kcal: 400, proteinG: 20, fatG: 15, carbsG: 40 },
  estimatedExtraCostKopecks: 0,
  ...over,
});

const CTX = (over: Partial<GenerationContext> = {}): GenerationContext => ({
  now: NOW,
  pantry: [],
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
  ...over,
});

// --- timeMatch ---

test('timeMatch: within budget → 1', () => {
  assert.equal(timeMatch(recipe(), CTX({ maxMinutes: 30 })), 1);
});

test('timeMatch: equal to budget → 1', () => {
  assert.equal(timeMatch(recipe(), CTX({ maxMinutes: 30 })), 1);
});

test('timeMatch: 50% overrun → 0.5', () => {
  // total 30, max 20 → overrun 10 → 1 − 10/20 = 0.5
  assert.ok(Math.abs(timeMatch(recipe(), CTX({ maxMinutes: 20 })) - 0.5) < 1e-9);
});

test('timeMatch: double overrun → 0', () => {
  assert.equal(timeMatch(recipe(), CTX({ maxMinutes: 15 })), 0);
});

test('timeMatch: maxMinutes 0 → 0 for any positive total', () => {
  assert.equal(timeMatch(recipe(), CTX({ maxMinutes: 0 })), 0);
});

// --- preferenceMatch ---

test('preferenceMatch: no preference config → neutral 0.5', () => {
  assert.equal(preferenceMatch(recipe(), CTX()), 0.5);
});

test('preferenceMatch: all LOVE → 1', () => {
  const ctx = CTX({
    preferences: {
      dietType: 'NONE',
      excludeIngredients: [],
      allergies: [],
      appliances: [],
      preferences: [
        { kind: 'LOVE', ingredientId: 'a' },
        { kind: 'LOVE', ingredientId: 'b' },
      ],
    },
  });
  assert.equal(preferenceMatch(recipe(), ctx), 1);
});

test('preferenceMatch: all DISLIKE → 0', () => {
  const ctx = CTX({
    preferences: {
      dietType: 'NONE',
      excludeIngredients: [],
      allergies: [],
      appliances: [],
      preferences: [{ kind: 'DISLIKE', ingredientId: 'a' }],
    },
  });
  assert.equal(preferenceMatch(recipe(), ctx), 0);
});

test('preferenceMatch: 1 LOVE + 1 DISLIKE → 0.5', () => {
  const ctx = CTX({
    preferences: {
      dietType: 'NONE',
      excludeIngredients: [],
      allergies: [],
      appliances: [],
      preferences: [
        { kind: 'LOVE', ingredientId: 'a' },
        { kind: 'DISLIKE', ingredientId: 'b' },
      ],
    },
  });
  assert.ok(Math.abs(preferenceMatch(recipe(), ctx) - 0.5) < 1e-9);
});

test('preferenceMatch: LOVE configured but recipe has none of them → 0.5 (no hits)', () => {
  const ctx = CTX({
    preferences: {
      dietType: 'NONE',
      excludeIngredients: [],
      allergies: [],
      appliances: [],
      preferences: [{ kind: 'LOVE', ingredientId: 'zzz' }],
    },
  });
  assert.ok(Math.abs(preferenceMatch(recipe(), ctx) - 0.5) < 1e-9);
});

// --- varietyScore ---

test('varietyScore: empty history → 1', () => {
  assert.equal(varietyScore(recipe(), CTX()), 1);
});

test('varietyScore: never cooked → 1', () => {
  const ctx = CTX({ recentRecipeIds7d: ['r_other1', 'r_other2'] });
  assert.equal(varietyScore(recipe(), ctx), 1);
});

test('varietyScore: cooked once of 4 plans → 0.75', () => {
  const ctx = CTX({ recentRecipeIds7d: ['r_x', 'r_a', 'r_b', 'r_c'] });
  assert.ok(Math.abs(varietyScore(recipe(), ctx) - 0.75) < 1e-9);
});

test('varietyScore: cooked every day → 0', () => {
  const ctx = CTX({ recentRecipeIds7d: ['r_x', 'r_x', 'r_x', 'r_x'] });
  assert.equal(varietyScore(recipe(), ctx), 0);
});
