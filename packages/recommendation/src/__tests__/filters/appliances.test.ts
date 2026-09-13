// MC-032 — appliances filter tests (audit round-4: empty inventory case).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliancesFilter } from '../../filters/appliances.js';
import type { FilterVerdict, GenerationContext, Recipe } from '../../types.js';

const CTX = (appliances: GenerationContext['preferences']['appliances']): GenerationContext => ({
  now: new Date('2026-09-14T10:00:00Z'),
  pantry: [],
  preferences: {
    dietType: 'NONE',
    excludeIngredients: [],
    allergies: [],
    appliances,
    preferences: [],
  },
  maxMinutes: 120,
  antiFilters: [],
  recentRecipeIds7d: [],
  mealsPerDay: 3,
});

const recipe = (required: Recipe['requiredAppliances']): Recipe => ({
  id: 'r1',
  title: 'T',
  mealTypes: ['DINNER'],
  difficulty: 1,
  prepMinutes: 10,
  cookMinutes: 10,
  requiredAppliances: required,
  ingredients: [],
  tags: [],
  instructionsText: [],
  leftoverSourceOf: [],
  chainTags: [],
  nutrition: { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
  estimatedExtraCostKopecks: 0,
});

test('appliances: missing appliance rejects with APPLIANCE_MISSING', () => {
  const verdict = appliancesFilter(recipe(['OVEN']), CTX(['STOVE'])) as FilterVerdict;
  assert.notEqual(verdict, true);
  if (verdict !== true)
    assert.deepEqual(verdict.reject, { code: 'APPLIANCE_MISSING', appliance: 'OVEN' });
});

test('appliances: all required present passes', () => {
  assert.equal(appliancesFilter(recipe(['STOVE']), CTX(['STOVE'])), true);
});

test('appliances: EMPTY inventory passes everything (new user, audit round-4)', () => {
  assert.equal(appliancesFilter(recipe(['OVEN', 'BLENDER']), CTX([])), true);
  assert.equal(appliancesFilter(recipe(['STOVE']), CTX([])), true);
});

test('appliances: no required appliances always passes', () => {
  assert.equal(appliancesFilter(recipe([]), CTX(['STOVE'])), true);
  assert.equal(appliancesFilter(recipe([]), CTX([])), true);
});
