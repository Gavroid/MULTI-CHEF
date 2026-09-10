// MC-032 — Drift test: Σ FACTOR_WEIGHTS === 1.0 (falls CI if weights drift).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACTOR_WEIGHTS, FACTOR_NAMES } from '../scoring/weights.js';

test('weights: Σ FACTOR_WEIGHTS === 1.0 (±1e-9)', () => {
  const sum = Object.values(FACTOR_WEIGHTS).reduce((a: number, b: number) => a + b, 0);
  assert.ok(Math.abs(sum - 1.0) <= 1e-9, `weights drift: Σ = ${sum}`);
});

test('weights: every factor has a weight in (0, 1) and FACTOR_NAMES covers all keys', () => {
  for (const name of FACTOR_NAMES) {
    const w = FACTOR_WEIGHTS[name];
    assert.ok(w > 0 && w < 1, `${name} weight ${w} outside (0,1)`);
  }
  assert.equal(FACTOR_NAMES.length, Object.keys(FACTOR_WEIGHTS).length);
});
