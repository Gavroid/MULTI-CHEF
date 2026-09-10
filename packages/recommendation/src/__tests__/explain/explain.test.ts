// MC-032 — buildExplanation tests: passed recipes → top factors,
// rejected → rejection phrase.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExplanation } from '../../explain.js';
import { rank, scoreRecipe } from '../../scoring/index.js';
import type { ScoredRecipe } from '../../types.js';
import { CATALOG_RECIPES, SCENARIO_A, SCENARIO_C } from '../fixtures/expectedScores.js';

const fromCatalog = (id: string): ScoredRecipe => {
  const recipe = CATALOG_RECIPES.find((r) => r.id === id)!;
  return scoreRecipe(recipe, SCENARIO_A.ctx);
};

test('explain: full-pantry pasta mentions pantry coverage', () => {
  const text = buildExplanation(fromCatalog('r_pasta_grib'));
  assert.match(text, /есть почти все продукты дома/);
});

test('explain: neutral recipe falls back to «нейтральный вариант»', () => {
  const recipe = CATALOG_RECIPES.find((r) => r.id === 'r_omelet')!;
  const scored: ScoredRecipe = {
    recipe,
    score: 0,
    passed: true,
    breakdown: {
      pantryMatch: { value: 0, weight: 0.25, contribution: 0 },
      expirationBenefit: { value: 0, weight: 0.2, contribution: 0 },
      budgetMatch: { value: 0, weight: 0.15, contribution: 0 },
      nutritionMatch: { value: 0, weight: 0.15, contribution: 0 },
      timeMatch: { value: 0, weight: 0.1, contribution: 0 },
      preferenceMatch: { value: 0, weight: 0.1, contribution: 0 },
      varietyScore: { value: 0, weight: 0.05, contribution: 0 },
    },
  };
  assert.equal(buildExplanation(scored), 'нейтральный вариант');
});

test('explain: rejected recipe explains why (anti-recipe chip label)', () => {
  const scored = rank(CATALOG_RECIPES, {
    ...SCENARIO_A.ctx,
    antiFilters: ['NO_OVEN'],
  }).find((s) => !s.passed && s.recipe.id === 'r_chicken_oven');
  assert.ok(scored, 'chicken oven must be rejected by NO_OVEN');
  assert.equal(buildExplanation(scored!), 'исключено: нужна духовка');
});

test('explain: scenario C top salad mentions expiring products', () => {
  const scored = rank(CATALOG_RECIPES, SCENARIO_C.ctx);
  const text = buildExplanation(scored[0]!);
  assert.match(text, /использует продукты, которые скоро испортятся/);
});

test('explain: maxReasons caps the number of phrases', () => {
  const scored = rank(CATALOG_RECIPES, SCENARIO_A.ctx);
  const text = buildExplanation(scored[0]!, 1);
  assert.equal(text.split(' · ').length, 1);
});
