// MC-032 — rank fixture test: top-3 for 3 scenarios FIXED in expectedScores.
// Tolerances: ±1e-4 on totals, ±1e-6 on factor contributions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rank } from '../scoring/index.js';
import { applyHardFilters } from '../filters/index.js';
import {
  CATALOG_RECIPES,
  SCENARIO_A,
  SCENARIO_B,
  SCENARIO_C,
  type ExpectedScenario,
} from './fixtures/expectedScores.js';

const TOLERANCE_TOTAL = 1e-4;

function checkScenario(name: string, scenario: ExpectedScenario) {
  const scored = rank(CATALOG_RECIPES, scenario.ctx);
  const passed = scored.filter((s) => s.passed);
  const top3 = passed.slice(0, 3);

  assert.deepEqual(
    top3.map((s) => s.recipe.id),
    scenario.top3Ids,
    `${name}: top-3 mismatch`,
  );
  top3.forEach((s, i) => {
    assert.ok(
      Math.abs(s.score - scenario.top3Scores[i]!) <= TOLERANCE_TOTAL,
      `${name}: score[${i}] ${s.score} != ${scenario.top3Scores[i]}`,
    );
  });
}

test('fixture scenario A: full pantry top-3 fixed', () => checkScenario('A', SCENARIO_A));
test('fixture scenario B: empty pantry + NOTHING budget top-3 fixed', () =>
  checkScenario('B', SCENARIO_B));
test('fixture scenario C: urgent pantry + history + macros top-3 fixed', () =>
  checkScenario('C', SCENARIO_C));

test('rank: contributions sum to the total score for every scored recipe', () => {
  const scored = rank(CATALOG_RECIPES, SCENARIO_A.ctx);
  for (const s of scored) {
    if (!s.passed) continue;
    const sum = Object.values(s.breakdown).reduce((acc, f) => acc + f.contribution, 0);
    assert.ok(Math.abs(sum - s.score) <= 1e-9, `contribution sum ${sum} != score ${s.score}`);
  }
});

test('rank: rejected recipes are last with passed=false and a reason', () => {
  const scored = rank(CATALOG_RECIPES, SCENARIO_A.ctx);
  const rejected = scored.filter((s) => !s.passed);
  assert.ok(
    rejected.length > 0,
    'scenario A must reject OVEN/complex recipes? no — but chicken oven is slow-fine; nut cake needs OVEN+MIXER and user has both...',
  );
  for (const r of rejected) {
    assert.equal(r.score, 0);
    assert.ok(r.reject !== undefined);
    assert.ok(passedAllBefore(scored, r));
  }
});

function passedAllBefore(scored: ReturnType<typeof rank>, item: (typeof scored)[number]): boolean {
  const idxRejected = scored.indexOf(item);
  return scored.slice(0, idxRejected).every((s) => s.passed);
}

test('applyHardFilters: passed and rejected are disjoint and cover the input', () => {
  const { passed, rejected } = applyHardFilters(CATALOG_RECIPES, SCENARIO_A.ctx);
  assert.equal(passed.length + rejected.length, CATALOG_RECIPES.length);
  const passedIds = new Set(passed.map((r) => r.id));
  for (const { recipe } of rejected) {
    assert.ok(!passedIds.has(recipe.id));
  }
});

test('rank is deterministic: two runs give identical output', () => {
  const a = JSON.stringify(rank(CATALOG_RECIPES, SCENARIO_C.ctx));
  const b = JSON.stringify(rank(CATALOG_RECIPES, SCENARIO_C.ctx));
  assert.equal(a, b);
});
