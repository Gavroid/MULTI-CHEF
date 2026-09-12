// MC-042 — Unit tests for the roulette building blocks: weighted pick,
// in-memory counter (TTL), Redis adapter against a fake client.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickWeightedByScore } from '../pick-roulette.js';
import {
  InMemoryRouletteCounter,
  RedisRouletteCounter,
  ROULETTE_TTL_SECONDS,
  type RedisLike,
} from '../roulette-counter.js';
import type { Recipe, ScoreBreakdown, ScoredRecipe } from '@multichef/recommendation';

function makeScored(id: string, score: number, passed = true): ScoredRecipe {
  const breakdown = {} as ScoreBreakdown;
  for (const name of [
    'pantryMatch',
    'expirationBenefit',
    'budgetMatch',
    'nutritionMatch',
    'timeMatch',
    'preferenceMatch',
    'varietyScore',
    'noveltyScore',
  ] as const) {
    breakdown[name] = { value: 0, weight: 0, contribution: 0 };
  }
  const recipe: Recipe = {
    id,
    title: `T ${id}`,
    mealTypes: ['LUNCH'],
    difficulty: 1,
    prepMinutes: 10,
    cookMinutes: 10,
    requiredAppliances: [],
    ingredients: [],
    tags: [],
    instructionsText: [],
    leftoverSourceOf: [],
    chainTags: [],
    nutrition: { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
    estimatedExtraCostKopecks: 0,
  };
  return { recipe, score, passed, breakdown };
}

/* ---------------- pickWeightedByScore ---------------- */

test('pickWeightedByScore: empty passed list → null (service maps to 422)', () => {
  assert.equal(
    pickWeightedByScore([makeScored('a', 0.9, false)], () => 0),
    null,
  );
  assert.equal(
    pickWeightedByScore([], () => 0),
    null,
  );
});

test('pickWeightedByScore: rng=0 → first, rng→1 → last (weighted walk)', () => {
  const ranked = [makeScored('a', 0.5), makeScored('b', 0.3), makeScored('c', 0.2)];
  assert.equal(pickWeightedByScore(ranked, () => 0)?.recipe.id, 'a');
  assert.equal(pickWeightedByScore(ranked, () => 0.999)?.recipe.id, 'c');
});

test('pickWeightedByScore: higher-scored recipes are picked more often', () => {
  const ranked = [makeScored('heavy', 0.9), makeScored('light', 0.1)];
  let heavy = 0;
  for (let i = 0; i < 1000; i++) {
    const picked = pickWeightedByScore(ranked, Math.random);
    if (picked?.recipe.id === 'heavy') heavy += 1;
  }
  assert.ok(heavy > 700, `heavy should dominate (~90%), got ${heavy}/1000`);
});

test('pickWeightedByScore: all-zero scores fall back to uniform pick', () => {
  const ranked = [makeScored('a', 0), makeScored('b', 0)];
  const picked = pickWeightedByScore(ranked, () => 0.5);
  assert.ok(picked?.recipe.id === 'a' || picked?.recipe.id === 'b');
});

/* ---------------- InMemoryRouletteCounter ---------------- */

test('InMemoryRouletteCounter: incr counts, get reads, TTL=0 expires immediately', async () => {
  const counter = new InMemoryRouletteCounter();
  assert.equal(await counter.get('h1'), 0);
  assert.equal(await counter.incr('h1', ROULETTE_TTL_SECONDS), 1);
  assert.equal(await counter.incr('h1', ROULETTE_TTL_SECONDS), 2);
  assert.equal(await counter.get('h1'), 2);
  assert.equal(await counter.incr('expired', 0), 1);
  assert.equal(await counter.get('expired'), 0, 'ttl 0 → already expired');
});

test('InMemoryRouletteCounter: keys are independent', async () => {
  const counter = new InMemoryRouletteCounter();
  await counter.incr('h1', ROULETTE_TTL_SECONDS);
  assert.equal(await counter.get('h2'), 0);
});

/* ---------------- RedisRouletteCounter (fake client) ---------------- */

test('RedisRouletteCounter: sets TTL only on first incr, parses get', async () => {
  let value = 0;
  const expires: number[] = [];
  const fake: RedisLike = {
    incr: async () => {
      value += 1;
      return value;
    },
    expire: async (_key: string, seconds: number) => {
      expires.push(seconds);
      return 1;
    },
    get: async () => (value === 0 ? null : String(value)),
  };
  const counter = new RedisRouletteCounter(fake);
  assert.equal(await counter.incr('h1', ROULETTE_TTL_SECONDS), 1);
  assert.deepEqual(expires, [ROULETTE_TTL_SECONDS], 'TTL set on first incr');
  assert.equal(await counter.incr('h1', ROULETTE_TTL_SECONDS), 2);
  assert.equal(expires.length, 1, 'TTL NOT reset on subsequent incr');
  assert.equal(await counter.get('h1'), 2);
  value = 0;
  assert.equal(await counter.get('h1'), 0, 'missing key reads as 0');
});
