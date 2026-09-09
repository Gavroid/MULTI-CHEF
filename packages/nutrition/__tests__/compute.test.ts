// MC-030 — Unit tests for computeRecipeNutrition (deterministic, no DB).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRecipeNutrition } from '../src/compute.js';
import type { IngredientWithQuantity } from '../src/types.js';

function ing(
  name: string,
  quantityG: number,
  facts: { per100: [number, number, number, number] } | null,
): IngredientWithQuantity {
  if (facts === null) return { canonicalName: name, quantityG, ingredientNutrition: null };
  const [kcal, p, f, c] = facts.per100;
  return {
    canonicalName: name,
    quantityG,
    ingredientNutrition: {
      servingSizeG: 100,
      servingCalories: kcal,
      servingProteinG: p,
      servingFatG: f,
      servingCarbsG: c,
    },
  };
}

test('compute: simple recipe 100 g tomato + 10 g oil → correct total and perServing', () => {
  const result = computeRecipeNutrition({
    servings: 1,
    ingredients: [
      ing('помидор', 100, { per100: [18, 0.9, 0.2, 3.9] }),
      ing('масло оливковое', 10, { per100: [884, 0, 100, 0] }),
    ],
  });
  // total: 18 + 88.4 = 106.4 kcal → 106; fat 0.2 + 10 = 10.2
  assert.equal(result.total.kcal, 106);
  assert.equal(result.total.proteinG, 0.9);
  assert.equal(result.total.fatG, 10.2);
  assert.equal(result.total.carbsG, 3.9);
  assert.equal(result.perServing.kcal, 106);
  assert.deepEqual(result.warnings, []);
});

test('compute: 4 servings divide total correctly (500 g ingredient, facts per 100 g)', () => {
  const result = computeRecipeNutrition({
    servings: 4,
    ingredients: [ing('картофель', 500, { per100: [77, 2, 0.1, 17] })],
  });
  // total: 77*5 = 385 kcal, protein 10, fat 0.5, carbs 85
  assert.equal(result.total.kcal, 385);
  assert.equal(result.total.proteinG, 10);
  assert.equal(result.total.fatG, 0.5);
  assert.equal(result.total.carbsG, 85);
  // per serving: 96.25 kcal → 96; protein 2.5; fat 0.125 → 0.1 (Math.round(1.25)=1... check); carbs 21.25 → 21.3
  assert.equal(result.perServing.kcal, 96);
  assert.equal(result.perServing.proteinG, 2.5);
  assert.equal(result.perServing.fatG, 0.1);
  assert.equal(result.perServing.carbsG, 21.3);
});

test('compute: missing nutrition (null) → MISSING_INGREDIENT_NUTRITION + skipped from sum', () => {
  const result = computeRecipeNutrition({
    servings: 2,
    ingredients: [
      ing('помидор', 300, { per100: [18, 0.9, 0.2, 3.9] }),
      ing('экзотический фрукт', 100, null),
    ],
  });
  // Only tomato counted: 18*3 = 54 kcal; unknown is 100/400 = 25% of weight → high impact
  assert.equal(result.total.kcal, 54);
  assert.equal(result.perServing.kcal, 27);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0]!.code, 'MISSING_INGREDIENT_NUTRITION');
  assert.equal(result.warnings[0]!.ingredientName, 'экзотический фрукт');
  assert.equal(result.warnings[0]!.impact, 'high');
});

test('compute: missing nutrition impact low when small share of dish', () => {
  const result = computeRecipeNutrition({
    servings: 1,
    ingredients: [ing('помидор', 990, { per100: [18, 0.9, 0.2, 3.9] }), ing('соль', 10, null)],
  });
  const warning = result.warnings.find((w) => w.code === 'MISSING_INGREDIENT_NUTRITION');
  assert.ok(warning && warning.code === 'MISSING_INGREDIENT_NUTRITION');
  assert.equal(warning.impact, 'low'); // 10/1000 = 1% ≤ 2%
});

test('compute: quantityG === 0 → INGREDIENT_QUANTITY_ZERO + skipped', () => {
  const result = computeRecipeNutrition({
    servings: 2,
    ingredients: [
      ing('помидор', 200, { per100: [18, 0.9, 0.2, 3.9] }),
      ing('масло оливковое', 0, { per100: [884, 0, 100, 0] }),
    ],
  });
  assert.equal(result.total.kcal, 36);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0]!.code, 'INGREDIENT_QUANTITY_ZERO');
  assert.equal(result.warnings[0]!.ingredientName, 'масло оливковое');
});

test('compute: quantityG < 0 → NEGATIVE_QUANTITY + skipped', () => {
  const result = computeRecipeNutrition({
    servings: 2,
    ingredients: [
      ing('помидор', 200, { per100: [18, 0.9, 0.2, 3.9] }),
      ing('масло оливковое', -50, { per100: [884, 0, 100, 0] }),
    ],
  });
  assert.equal(result.total.kcal, 36);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0]!.code, 'NEGATIVE_QUANTITY');
  assert.equal(result.warnings[0]!.ingredientName, 'масло оливковое');
});

test('compute: servings = 0 → SERVINGS_INVALID + fallback to 1', () => {
  const result = computeRecipeNutrition({
    servings: 0,
    ingredients: [ing('помидор', 100, { per100: [18, 0.9, 0.2, 3.9] })],
  });
  assert.equal(result.warnings[0]!.code, 'SERVINGS_INVALID');
  assert.equal(result.warnings[0]!.value, 0);
  // fallback servings=1 → perServing equals total
  assert.equal(result.perServing.kcal, result.total.kcal);
});

test('compute: servings = -1 → SERVINGS_INVALID + fallback to 1', () => {
  const result = computeRecipeNutrition({
    servings: -1,
    ingredients: [ing('помидор', 100, { per100: [18, 0.9, 0.2, 3.9] })],
  });
  assert.equal(result.warnings[0]!.code, 'SERVINGS_INVALID');
  assert.equal(result.perServing.kcal, result.total.kcal);
});

test('compute: empty ingredients → zeros, no warnings', () => {
  const result = computeRecipeNutrition({ servings: 2, ingredients: [] });
  assert.deepEqual(result.total, { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 });
  assert.deepEqual(result.perServing, { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 });
  assert.deepEqual(result.warnings, []);
});

test('compute: non-integer servingSizeG scales linearly (50 g serving)', () => {
  const result = computeRecipeNutrition({
    servings: 1,
    ingredients: [
      {
        canonicalName: 'яйцо куриное',
        quantityG: 120,
        ingredientNutrition: {
          servingSizeG: 55,
          servingCalories: 86,
          servingProteinG: 7,
          servingFatG: 6,
          servingCarbsG: 0.4,
        },
      },
    ],
  });
  // 120/55 = 2.1818... × 86 = 187.63... → 188
  assert.equal(result.total.kcal, 188);
  // protein: 2.1818 × 7 = 15.27 → 15.3
  assert.equal(result.total.proteinG, 15.3);
});

test('compute: deterministic — same input twice gives identical output', () => {
  const input = {
    servings: 3,
    ingredients: [
      ing('помидор', 150, { per100: [18, 0.9, 0.2, 3.9] }),
      ing('масло оливковое', 25, { per100: [884, 0, 100, 0] }),
      ing('неизвестное', 40, null),
    ],
  };
  const a = computeRecipeNutrition(input);
  const b = computeRecipeNutrition(input);
  assert.deepEqual(a, b);
});
