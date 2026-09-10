// MC-032 — budgetMatch factor tests (kopecks are integers).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetMatch } from '../../scoring/factors/budgetMatch.js';
import type { GenerationContext, Recipe } from '../../types.js';
import { NOW } from '../fixtures/pantry.js';

const recipe = (extraKopecks: number): Recipe => ({
  id: 'r',
  title: 'r',
  mealTypes: ['LUNCH'],
  difficulty: 1,
  prepMinutes: 5,
  cookMinutes: 5,
  requiredAppliances: [],
  ingredients: [],
  tags: [],
  instructionsText: [],
  leftoverSourceOf: [],
  nutrition: { kcal: 100, proteinG: 5, fatG: 5, carbsG: 10 },
  estimatedExtraCostKopecks: extraKopecks,
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

test('budgetMatch: no budget info → neutral 1', () => {
  assert.equal(budgetMatch(recipe(50000), CTX()), 1);
});

test('budgetMatch: zero extra cost → 1', () => {
  assert.equal(budgetMatch(recipe(0), CTX({ remainingBudgetKopecks: 10000 })), 1);
});

test('budgetMatch: extra far below budget → close to 1', () => {
  const value = budgetMatch(recipe(2000), CTX({ remainingBudgetKopecks: 100000 }));
  assert.ok(Math.abs(value - 0.98) < 1e-9);
});

test('budgetMatch: extra equals budget → 0', () => {
  assert.equal(budgetMatch(recipe(100000), CTX({ remainingBudgetKopecks: 100000 })), 0);
});

test('budgetMatch: extra above budget → clamped 0', () => {
  assert.equal(budgetMatch(recipe(150000), CTX({ remainingBudgetKopecks: 100000 })), 0);
});

test('budgetMatch: zero remaining budget → 0 for any positive extra', () => {
  assert.equal(budgetMatch(recipe(1), CTX({ remainingBudgetKopecks: 0 })), 0);
});

test('budgetMatch: budgetMode NOTHING — hard 0 when shopping needed', () => {
  assert.equal(budgetMatch(recipe(100), CTX({ budgetMode: 'NOTHING' })), 0);
});

test('budgetMatch: budgetMode NOTHING — 1 when nothing to buy', () => {
  assert.equal(budgetMatch(recipe(0), CTX({ budgetMode: 'NOTHING' })), 1);
});
