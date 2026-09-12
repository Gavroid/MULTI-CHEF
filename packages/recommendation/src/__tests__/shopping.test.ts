// MC-052 — buildShoppingList unit tests (development plan fixtures).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShoppingList, requiredGramsFromEntries } from '../shopping.js';
import type { ShoppingIngredientMeta } from '../shopping.js';

const meta = (id: string, over?: Partial<ShoppingIngredientMeta>): ShoppingIngredientMeta => ({
  ingredientId: id,
  packageSize: 500,
  avgPriceKopecks: 10_000,
  categoryId: 'cat-meat',
  categorySortOrder: 1,
  ...over,
});

test('requiredGramsFromEntries: sums grams × servings, skips optional', () => {
  const required = requiredGramsFromEntries([
    {
      servings: 2,
      ingredients: [
        { ingredientId: 'chicken', grams: 350, optional: false },
        { ingredientId: 'rice', grams: 200, optional: false },
        { ingredientId: 'herbs', grams: 20, optional: true },
      ],
    },
    {
      servings: 1,
      ingredients: [{ ingredientId: 'chicken', grams: 350, optional: false }],
    },
  ]);
  assert.equal(required.get('chicken')?.grams, 350 * 2 + 350);
  assert.equal(required.get('chicken')?.dishes, 2);
  assert.equal(required.get('rice')?.grams, 400);
  assert.equal(required.has('herbs'), false, 'optional ingredients are never purchased');
});

test('fixture: 700 g need with 500 g packages → 2 packages', () => {
  const items = buildShoppingList({
    requiredGrams: new Map([['fillet', 700]]),
    pantryGrams: new Map(),
    staples: new Set(),
    dishCounts: new Map([['fillet', 2]]),
    totalDishes: 4,
    meta: [meta('fillet', { packageSize: 500 })],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]!.packageQuantity, 2);
  assert.equal(items[0]!.estimatedPriceKopecks, 20_000);
  assert.ok(items[0]!.utilityScore >= 0 && items[0]!.utilityScore <= 10);
});

test('pantry stock covers the need → item not purchased', () => {
  const items = buildShoppingList({
    requiredGrams: new Map([['rice', 400]]),
    pantryGrams: new Map([['rice', 900]]),
    staples: new Set(),
    dishCounts: new Map(),
    totalDishes: 4,
    meta: [meta('rice', { categoryId: 'cat-grain', categorySortOrder: 3 })],
  });
  assert.deepEqual(items, []);
});

test('partial pantry stock: only the deficit is bought', () => {
  const items = buildShoppingList({
    requiredGrams: new Map([['rice', 700]]),
    pantryGrams: new Map([['rice', 300]]),
    staples: new Set(),
    dishCounts: new Map(),
    totalDishes: 4,
    meta: [meta('rice', { categoryId: 'cat-grain', categorySortOrder: 3 })],
  });
  assert.equal(items[0]!.requiredGrams, 400);
  assert.equal(items[0]!.packageQuantity, 1);
});

test('STAPLE items (salt, oil) are never purchased', () => {
  const items = buildShoppingList({
    requiredGrams: new Map([
      ['salt', 100],
      ['chicken', 700],
    ]),
    pantryGrams: new Map(),
    staples: new Set(['salt']),
    dishCounts: new Map(),
    totalDishes: 4,
    meta: [
      meta('salt', { categoryId: 'cat-spice', categorySortOrder: 9, packageSize: 1000 }),
      meta('chicken', { categoryId: 'cat-meat', categorySortOrder: 1 }),
    ],
  });
  assert.deepEqual(
    items.map((i) => i.ingredientId),
    ['chicken'],
  );
});

test('items are grouped by department sortOrder', () => {
  const items = buildShoppingList({
    requiredGrams: new Map([
      ['zucchini', 300],
      ['chicken', 700],
    ]),
    pantryGrams: new Map(),
    staples: new Set(),
    dishCounts: new Map(),
    totalDishes: 4,
    meta: [
      meta('zucchini', { categoryId: 'cat-veg', categorySortOrder: 5 }),
      meta('chicken', { categoryId: 'cat-meat', categorySortOrder: 1 }),
    ],
  });
  assert.deepEqual(
    items.map((i) => i.ingredientId),
    ['chicken', 'zucchini'],
    'meat department before vegetables',
  );
});

test('every item has utilityScore 0..10 and packageQuantity ≥ 1 (DoD)', () => {
  const items = buildShoppingList({
    requiredGrams: new Map([
      ['a', 10],
      ['b', 4999],
    ]),
    pantryGrams: new Map(),
    staples: new Set(),
    dishCounts: new Map([
      ['a', 1],
      ['b', 4],
    ]),
    totalDishes: 4,
    meta: [meta('a', { packageSize: 5000 }), meta('b', { packageSize: 500 })],
  });
  for (const item of items) {
    assert.ok(item.packageQuantity >= 1);
    assert.ok(item.utilityScore >= 0 && item.utilityScore <= 10);
  }
});
