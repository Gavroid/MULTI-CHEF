// MC-055 — plan view tests: helpers + initial wizard render.
// Full client flows (fetch polling) live behind deps seams — same
// approach as MC-034's LoadingClient/ResultClient.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { kcalPercent, mealLabel, PlanClient } from '../PlanClient';
import { toSetup, stageLabel, initialState } from '../setup/SetupClient';

test('kcalPercent: percent of the daily target, capped at 110', () => {
  assert.equal(kcalPercent(2000, 2000), 100);
  assert.equal(kcalPercent(500, 2000), 25);
  assert.equal(kcalPercent(3000, 2000), 110, 'over-eating is visible, not clamped to 100');
  assert.equal(kcalPercent(500, 0), 0);
});

test('mealLabel: russian labels for all four meal types', () => {
  assert.equal(mealLabel('BREAKFAST'), 'Завтрак');
  assert.equal(mealLabel('LUNCH'), 'Обед');
  assert.equal(mealLabel('DINNER'), 'Ужин');
  assert.equal(mealLabel('SNACK'), 'Перекус');
  assert.equal(mealLabel('MYSTERY'), 'MYSTERY');
});

test('toSetup: goals included only when set', () => {
  const base = toSetup({ ...initialState });
  assert.equal(base.peopleCount, 2);
  assert.equal(base.days, 7);
  assert.equal('targetBudgetKopecks' in base, false);
  const withGoals = toSetup({
    ...initialState,
    targetBudgetKopecks: 300_000,
    targetDailyCalories: 2000,
  });
  assert.equal(withGoals.targetBudgetKopecks, 300_000);
  assert.equal(withGoals.targetDailyCalories, 2000);
});

test('stageLabel: human labels for job stages', () => {
  assert.equal(stageLabel('queued'), 'В очереди…');
  assert.equal(stageLabel('scoring'), 'Оцениваем варианты…');
  assert.equal(stageLabel('done'), 'Готово!');
  assert.equal(stageLabel(null), 'В очереди…');
});

test('initialState: documented defaults', () => {
  assert.equal(initialState.step, 1);
  assert.equal(initialState.peopleCount, 2);
  assert.equal(initialState.days, 7);
  assert.equal(initialState.mealsPerDay, 3);
});

test('PlanClient initial render: skeletons while loading', () => {
  const html = renderToString(React.createElement(PlanClient));
  assert.match(html, /data-testid="plan-loading"/);
});
