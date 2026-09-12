// MC-032/MC-040 — Drift tests: Σ FACTOR_WEIGHTS === 1.0 (fails CI if
// weights drift). MC-040: varietyScore is intentionally 0.00 in the
// default profile (absorbed by noveltyScore); rescue preset checked too.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACTOR_WEIGHTS, FACTOR_NAMES, RESCUE_FACTOR_WEIGHTS } from '../scoring/weights.js';

test('weights: Σ FACTOR_WEIGHTS === 1.0 (±1e-9)', () => {
  const sum = Object.values(FACTOR_WEIGHTS).reduce((a: number, b: number) => a + b, 0);
  assert.ok(Math.abs(sum - 1.0) <= 1e-9, `weights drift: Σ = ${sum}`);
});

test('weights: every factor weight ∈ [0, 1) and FACTOR_NAMES covers all keys', () => {
  for (const name of FACTOR_NAMES) {
    const w = FACTOR_WEIGHTS[name];
    // MC-040: 0 is a legal weight now (varietyScore) — only forbid
    // negatives and ≥ 1.
    assert.ok(w >= 0 && w < 1, `${name} weight ${w} outside [0,1)`);
  }
  assert.equal(FACTOR_NAMES.length, Object.keys(FACTOR_WEIGHTS).length);
});

test('weights: at least 7 factors have strictly positive weight', () => {
  const positive = FACTOR_NAMES.filter((n) => FACTOR_WEIGHTS[n] > 0);
  assert.ok(positive.length >= 7, `only ${positive.length} positive weights`);
});

test('weights: RESCUE_FACTOR_WEIGHTS Σ === 1.0 (±1e-9) and forces expirationBenefit', () => {
  const sum = Object.values(RESCUE_FACTOR_WEIGHTS).reduce((a: number, b: number) => a + b, 0);
  assert.ok(Math.abs(sum - 1.0) <= 1e-9, `rescue weights drift: Σ = ${sum}`);
  assert.ok(
    RESCUE_FACTOR_WEIGHTS.expirationBenefit > FACTOR_WEIGHTS.expirationBenefit,
    'rescue preset must force expirationBenefit above the default',
  );
});
