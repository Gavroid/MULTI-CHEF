// MC-030 — Unit tests for rounding rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundNutrition, roundKcal, roundMacro } from '../src/rounding.js';

test('rounding: kcal 180.4 → 180 (integer)', () => {
  assert.equal(roundKcal(180.4), 180);
});

test('rounding: kcal 180.5 → 181 (half rounds away from zero)', () => {
  assert.equal(roundKcal(180.5), 181);
  assert.equal(roundKcal(180), 180);
});

test('rounding: proteinG 12.34 → 12.3 (one decimal)', () => {
  assert.equal(roundMacro(12.34), 12.3);
});

test('rounding: macro 12.35 → 12.4 (standard Math.round half-up; NOT banker\u2019s rounding)', () => {
  // JS Math.round(12.35 * 10) === 124 because 12.35*10 is exactly 123.50000000000001 in IEEE 754.
  // This is the documented behaviour: standard Math.round, deterministic across platforms.
  assert.equal(roundMacro(12.35), 12.4);
  assert.equal(roundMacro(23.45), 23.5);
  assert.equal(roundMacro(5.678), 5.7);
});

test('rounding: roundNutrition applies per-field rules', () => {
  const rounded = roundNutrition({ kcal: 180.4, proteinG: 12.34, fatG: 5.678, carbsG: 23.45 });
  assert.deepEqual(rounded, { kcal: 180, proteinG: 12.3, fatG: 5.7, carbsG: 23.5 });
});
