// MC-054 — fitBudgetProposals unit tests (order, thresholds, honesty).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitBudgetProposals, type BudgetItem } from '../fit-budget.js';

const item = (over: Partial<BudgetItem>): BudgetItem => ({
  ingredientId: 'x',
  estimatedPriceKopecks: 10_000,
  utilityScore: 5,
  optionalOnly: false,
  substituteIngredientId: null,
  substitutePriceKopecks: null,
  ...over,
});

test('SUBSTITUTE: only ≥30% cheaper substitutes are proposed', () => {
  const result = fitBudgetProposals(
    [
      item({ ingredientId: 'a', substituteIngredientId: 'a2', substitutePriceKopecks: 6_000 }),
      item({ ingredientId: 'b', substituteIngredientId: 'b2', substitutePriceKopecks: 9_000 }),
    ],
    5_000,
    19_000,
  );
  assert.deepEqual(
    result.proposals.filter((p) => p.kind === 'SUBSTITUTE').map((p) => p.ingredientId),
    ['a'],
    'b saves only 10% — below the 30% threshold',
  );
});

test('order: SUBSTITUTE before DROP_OPTIONAL, savings descending', () => {
  const result = fitBudgetProposals(
    [
      item({ ingredientId: 'opt', optionalOnly: true, estimatedPriceKopecks: 3_000 }),
      item({ ingredientId: 'a', substituteIngredientId: 'a2', substitutePriceKopecks: 4_000 }),
      item({
        ingredientId: 'c',
        substituteIngredientId: 'c2',
        substitutePriceKopecks: 1_000,
        estimatedPriceKopecks: 5_000,
      }),
    ],
    5_000,
    18_000,
  );
  const kinds = result.proposals.map((p) => p.kind);
  assert.equal(kinds[0], 'SUBSTITUTE');
  assert.ok(kinds.indexOf('DROP_OPTIONAL') > kinds.lastIndexOf('SUBSTITUTE'));
  // 'a' saves 6000 (10000→4000), 'c' saves 4000 (5000→1000) — desc order.
  assert.equal(result.proposals[0]!.savingKopecks, 6_000);
  assert.equal(result.proposals[1]!.savingKopecks, 4_000);
});

test('substitute already on the list → not proposed', () => {
  const result = fitBudgetProposals(
    [
      item({
        ingredientId: 'a',
        substituteIngredientId: 'a2',
        substitutePriceKopecks: 1_000,
        substituteAlreadyListed: true,
      }),
    ],
    5_000,
    10_000,
  );
  assert.equal(result.proposals.length, 0);
});

test('honest answer: savings below the over-budget gap → achievable false', () => {
  const result = fitBudgetProposals(
    [item({ ingredientId: 'opt', optionalOnly: true, estimatedPriceKopecks: 2_000 })],
    5_000,
    10_000,
  );
  assert.equal(result.achievable, false);
  assert.equal(result.minimalTotalKopecks, 8_000);
});

test('achievable: proposals cover the over-budget gap', () => {
  const result = fitBudgetProposals(
    [
      item({ ingredientId: 'opt1', optionalOnly: true, estimatedPriceKopecks: 3_000 }),
      item({ ingredientId: 'opt2', optionalOnly: true, estimatedPriceKopecks: 3_000 }),
    ],
    5_000,
    10_000,
  );
  assert.equal(result.achievable, true);
  assert.equal(result.totalPossibleSavings, 6_000);
});
