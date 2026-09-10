// MC-032 — nutritionMatch factor tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nutritionMatch } from '../../scoring/factors/nutritionMatch.js';
import type { GenerationContext, Recipe } from '../../types.js';
import { NOW } from '../fixtures/pantry.js';

const recipe = (kcal: number, p: number, f: number, c: number): Recipe => ({
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
  nutrition: { kcal, proteinG: p, fatG: f, carbsG: c },
  estimatedExtraCostKopecks: 0,
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
  targetDailyMacros: { calories: 2100, proteinG: 90, fatG: 70, carbsG: 260 },
  ...over,
});

test('nutritionMatch: no target configured → 1', () => {
  const ctx = CTX();
  delete ctx.targetDailyMacros;
  assert.equal(nutritionMatch(recipe(500, 20, 20, 50), ctx), 1);
});

test('nutritionMatch: exact target per meal (2100/3) → 1', () => {
  const value = nutritionMatch(recipe(700, 30, 23.33, 86.67), CTX());
  assert.ok(value > 0.98, `expected ~1, got ${value}`);
});

test('nutritionMatch: 50% deviation on one macro → that macro contributes 0', () => {
  // kcal target 700; 1050 = +50% → kcal term 0; others near target.
  const ctx = CTX();
  const exact = nutritionMatch(recipe(700, 30, 23.33, 86.67), ctx);
  const deviated = nutritionMatch(recipe(1050, 30, 23.33, 86.67), ctx);
  assert.ok(deviated < exact, `deviated ${deviated} should be < exact ${exact}`);
});

test('nutritionMatch: huge deviation everywhere → 0', () => {
  assert.equal(nutritionMatch(recipe(100, 0, 0, 0), CTX()), 0);
});

test('nutritionMatch: mealsPerDay 0 → neutral 1', () => {
  assert.equal(nutritionMatch(recipe(100, 0, 0, 0), CTX({ mealsPerDay: 0 })), 1);
});

test('nutritionMatch: zero target on a macro is skipped, not fatal', () => {
  const ctx = CTX({ targetDailyMacros: { calories: 2100, proteinG: 0, fatG: 70, carbsG: 260 } });
  const value = nutritionMatch(recipe(700, 30, 23.33, 86.67), ctx);
  assert.ok(value > 0 && value <= 1);
});
