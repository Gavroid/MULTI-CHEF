// MC-INGREDIENT-NUTRITION — unit tests for the nutrition seed catalog.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NUTRITION_TABLE, CATALOG_TO_NUTRITION } from '../seed/nutrition/index.js';
import { RECIPES } from '../seed/recipes/index.js';

test('nutrition catalog: NUTRITION_TABLE has >=80 keys with realistic macro values', () => {
  const keys = Object.keys(NUTRITION_TABLE);
  assert.ok(keys.length >= 80, `expected >=80 nutrition keys, got ${keys.length}`);
  for (const [key, entry] of Object.entries(NUTRITION_TABLE)) {
    assert.equal(entry.key, key, `entry key mismatch for ${key}`);
    assert.equal(entry.servingSizeG, 100, `servingSizeG must be 100 for ${key}`);
    assert.ok(
      Number.isFinite(entry.servingCalories) && entry.servingCalories >= 0,
      `kcal must be non-negative for ${key}`,
    );
    assert.ok(
      entry.servingProteinG >= 0 && entry.servingFatG >= 0 && entry.servingCarbsG >= 0,
      `macros must be non-negative for ${key}`,
    );
    // Realism guard: nothing seeded should exceed pure-fat energy density.
    assert.ok(
      entry.servingCalories <= 900,
      `kcal/100g unrealistically high for ${key}: ${entry.servingCalories}`,
    );
    assert.ok(
      ['USDA', 'OFFICIAL', 'INTERNAL'].includes(entry.source),
      `unknown source for ${key}: ${entry.source}`,
    );
  }
});

test('nutrition catalog: CATALOG_TO_NUTRITION covers >=80% of distinct recipe ingredients', () => {
  const used = new Set<string>();
  for (const recipe of RECIPES) {
    for (const ing of recipe.ingredients) {
      used.add(ing.canonicalName);
    }
  }
  const covered = [...used].filter((name) => {
    const key = CATALOG_TO_NUTRITION[name];
    return key !== undefined && NUTRITION_TABLE[key] !== undefined;
  });
  const coverage = covered.length / used.size;
  assert.ok(
    coverage >= 0.8,
    `coverage ${(coverage * 100).toFixed(1)}% (${covered.length}/${used.size}) is below 80%`,
  );
  // Actual state: mapping is total (100%).
  assert.equal(covered.length, used.size);
});

test('nutrition catalog: every mapping points to an existing NUTRITION_TABLE key', () => {
  for (const [name, key] of Object.entries(CATALOG_TO_NUTRITION)) {
    assert.ok(
      NUTRITION_TABLE[key] !== undefined,
      `catalog ingredient "${name}" maps to missing nutrition key "${key}"`,
    );
  }
});

test('nutrition catalog: no duplicate keys / slug collisions', () => {
  const keys = Object.keys(NUTRITION_TABLE);
  assert.equal(keys.length, new Set(keys).size, 'duplicate keys in NUTRITION_TABLE');
  const mapped = Object.values(CATALOG_TO_NUTRITION);
  assert.equal(mapped.length, new Set(mapped).size, 'two catalog names share one nutrition key');
});

test('nutrition catalog: zero-kcal entries are only plausible (water, ice, salt, leavening, dye)', () => {
  const allowed = new Set([
    'krasitel-pischevoy',
    'led',
    'mineralnaya-voda',
    'razryhlitel',
    'soda',
    'sol',
    'voda',
  ]);
  for (const [key, entry] of Object.entries(NUTRITION_TABLE)) {
    if (entry.servingCalories === 0) {
      assert.ok(allowed.has(key), `zero kcal suspicious for ${key}`);
    }
  }
});
