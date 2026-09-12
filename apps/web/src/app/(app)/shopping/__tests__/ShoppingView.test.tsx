// MC-056 — shopping view tests: grouping, budget bar, format.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { budgetPercent, formatKopecks, groupItems, ShoppingClient } from '../ShoppingClient';
import type { ShoppingItemDto } from '@/lib/shopping-client';

const item = (
  id: string,
  ingredientId: string,
  over?: Partial<ShoppingItemDto>,
): ShoppingItemDto => ({
  id,
  ingredientId,
  requiredGrams: 400,
  packageQuantity: 1,
  packageSize: 500,
  estimatedPriceKopecks: 10_000,
  utilityScore: 7,
  purchased: false,
  categoryId: 'cat-meat',
  sortOrder: 1,
  ...over,
});

test('formatKopecks: roubles from kopecks', () => {
  assert.equal(formatKopecks(24_000), '₽240');
  assert.equal(formatKopecks(0), '₽0');
});

test('budgetPercent: capped at 110, zero-limit safe', () => {
  assert.equal(budgetPercent(200_000, 400_000), 50);
  assert.equal(budgetPercent(500_000, 400_000), 110);
  assert.equal(budgetPercent(100, null), 0);
});

test('groupItems: departments in sortOrder order', () => {
  const orders = new Map([
    ['cat-meat', 1],
    ['cat-veg', 5],
  ]);
  const groups = groupItems(
    [item('1', 'zucchini', { categoryId: 'cat-veg', sortOrder: 5 }), item('2', 'chicken')],
    orders,
  );
  assert.deepEqual(
    groups.map((g) => g.categoryId),
    ['cat-meat', 'cat-veg'],
  );
});

test('ShoppingClient initial render: loading state, no router', () => {
  const html = renderToString(React.createElement(ShoppingClient));
  assert.match(html, /data-testid="shopping-loading"/);
});
