// MC-033 PR#1 — type-level test: Recipe DTO accepts optional chainTags
// and stays assignable everywhere the package consumes it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rank, scoreRecipe, buildExplanation } from '../index.js';
import type { Recipe } from '../types.js';

const recipe: Recipe = {
  id: 'r_chain',
  title: 'Chain recipe',
  mealTypes: ['LUNCH'],
  difficulty: 1,
  prepMinutes: 10,
  cookMinutes: 15,
  requiredAppliances: ['STOVE'],
  ingredients: [
    { ingredientId: 'a', categoryGroup: 'GRAIN', grams: 200, name: 'a', optional: false },
  ],
  tags: [],
  instructionsText: ['Сварить'],
  leftoverSourceOf: [],
  chainTags: ['kurinyy-bulon-week', 'pasta-week'],
  nutrition: { kcal: 400, proteinG: 15, fatG: 10, carbsG: 60 },
  estimatedExtraCostKopecks: 0,
};

const ctx = {
  now: new Date('2026-09-10T10:00:00Z'),
  pantry: [],
  preferences: {
    dietType: 'NONE' as const,
    excludeIngredients: [],
    allergies: [],
    appliances: ['STOVE' as const],
    preferences: [],
  },
  maxMinutes: 60,
  antiFilters: [],
  recentRecipeIds7d: [],
  mealsPerDay: 3,
};

test('chainTags: recipe without chainTags (omitted) still scores — MC-032 compat', () => {
  const { chainTags: _omitted, ...without } = recipe;
  const scored = scoreRecipe(without, ctx);
  assert.ok(scored.passed);
  assert.ok(scored.score >= 0 && scored.score <= 1);
});

test('chainTags: recipe with chainTags scores identically (chainTags not in scoring)', () => {
  const withTags = scoreRecipe(recipe, ctx);
  const { chainTags: _omitted, ...without } = recipe;
  const withoutTags = scoreRecipe(without, ctx);
  assert.equal(withTags.score, withoutTags.score);
});

test('chainTags: rank + explain accept the extended DTO', () => {
  const ranked = rank([recipe], ctx);
  assert.equal(ranked.length, 1);
  assert.ok(typeof buildExplanation(ranked[0]!) === 'string');
});

test('chainTags: type shape — undefined when not provided, string[] when provided', () => {
  const bare: Recipe = { ...recipe };
  delete bare.chainTags; // optional → deletable (exactOptionalPropertyTypes-safe)
  assert.equal(bare.chainTags, undefined);
  assert.deepEqual(recipe.chainTags, ['kurinyy-bulon-week', 'pasta-week']);
});
