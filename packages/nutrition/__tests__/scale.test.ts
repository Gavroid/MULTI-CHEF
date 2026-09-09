// MC-030 — Unit tests for scaleNutrition / combineNutrition.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scaleNutrition, combineNutrition } from '../src/scale.js';
import type { NutritionFacts } from '../src/types.js';

function facts(kcal: number, p: number, f: number, c: number): NutritionFacts {
  return { kcal, proteinG: p, fatG: f, carbsG: c };
}

test('scale: double servings → total × 2, perServing unchanged', () => {
  const original = {
    total: facts(385, 10, 0.5, 85),
    perServing: facts(96, 2.5, 0.1, 21.3),
    currentServings: 4,
  };
  const scaled = scaleNutrition(original, 8);
  assert.equal(scaled.total.kcal, 770);
  assert.equal(scaled.total.proteinG, 20);
  assert.equal(scaled.total.carbsG, 170);
  assert.deepEqual(scaled.perServing, original.perServing);
});

test('scale: half servings → total ÷ 2', () => {
  const original = {
    total: facts(400, 20, 10, 50),
    perServing: facts(100, 5, 2.5, 12.5),
    currentServings: 4,
  };
  const scaled = scaleNutrition(original, 2);
  assert.equal(scaled.total.kcal, 200);
  assert.equal(scaled.total.proteinG, 10);
  assert.equal(scaled.total.fatG, 5);
  assert.equal(scaled.total.carbsG, 25);
  assert.deepEqual(scaled.perServing, original.perServing);
});

test('combine: breakfast + lunch + dinner → day total is the sum', () => {
  const breakfast = facts(350, 15, 10, 45);
  const lunch = facts(620, 35, 22, 60);
  const dinner = facts(540, 30, 18, 55);
  const day = combineNutrition([breakfast, lunch, dinner]);
  assert.equal(day.total.kcal, 1510);
  assert.equal(day.total.proteinG, 80);
  assert.equal(day.total.fatG, 50);
  assert.equal(day.total.carbsG, 160);
  assert.equal(day.byMeal.length, 3);
  assert.deepEqual(day.byMeal[0], breakfast);
  assert.deepEqual(day.byMeal[2], dinner);
});

test('combine: empty meals → zero total, empty breakdown', () => {
  const day = combineNutrition([]);
  assert.deepEqual(day.total, { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 });
  assert.deepEqual(day.byMeal, []);
});

test('combine: rounds fractional sums by PRD convention', () => {
  const a = facts(100.4, 12.34, 0, 0);
  const b = facts(50.5, 0.06, 0, 0);
  const day = combineNutrition([a, b]);
  // kcal: 150.9 → 151; protein: 12.4 → 12.4
  assert.equal(day.total.kcal, 151);
  assert.equal(day.total.proteinG, 12.4);
});

test('scale: same input twice → identical output (determinism)', () => {
  const original = {
    total: facts(123.456, 7.777, 1.234, 9.999),
    perServing: facts(61.728, 3.888, 0.617, 4.9995),
    currentServings: 2,
  };
  const a = scaleNutrition(original, 5);
  const b = scaleNutrition(original, 5);
  assert.deepEqual(a, b);
});
