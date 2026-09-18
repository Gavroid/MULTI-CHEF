// Rescue UI component tests (MC-040): usage bar, option cards, picker
// chip grouping. Pure render via renderToString — handlers and router
// live in RescueClient (untested here, same seam as MC-034's
// ResultClient/LoadingClient).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { formatGrams, RescueResults } from '../components/RescueResults';
import { chipLabel, selectPickerChips } from '../components/IngredientPicker';
import { RescueError } from '../components/RescueError';
import type { PantryItem } from '@/lib/pantry-client';
import type { RescueResponseDto } from '@multichef/contracts';

const recipe = (id: string, title: string) => ({
  id,
  title,
  description: null,
  servings: 2,
  prepMinutes: 10,
  cookMinutes: 20,
  difficulty: 1,
  mealTypes: ['LUNCH' as const],
  tags: [] as string[],
  requiredAppliances: [] as string[],
});

const result: RescueResponseDto = {
  options: [
    {
      type: 'FROM_PANTRY',
      recipe: recipe('r1', 'Сырники'),
      score: 0.88,
      explanation: 'использует продукты, которые скоро испортятся',
      toBuyCount: 0,
      chainTag: null,
    },
    {
      type: 'FROM_PANTRY',
      recipe: recipe('r2', 'Запеканка'),
      score: 0.72,
      explanation: 'есть почти все продукты дома',
      toBuyCount: 2,
      chainTag: null,
    },
  ],
  nutritionAccuracy: 'ESTIMATED',
  generatedAt: new Date().toISOString(),
  pantryUsage: { usedGrams: 400, totalGrams: 400 },
  ingredient: { id: 'tvorog', canonicalName: 'Творог', totalGrams: 400 },
};

/** renderToString interleaves <!-- --> markers between text nodes. */
function text(html: string): string {
  return html.replace(/<!--.*?-->/g, '');
}

/* ---------------- formatGrams ---------------- */

test('formatGrams: integers plain, fractions with one decimal', () => {
  assert.equal(formatGrams(400), '400 г');
  assert.equal(formatGrams(250.5), '250.5 г');
  assert.equal(formatGrams(250.44), '250.4 г');
});

/* ---------------- RescueResults ---------------- */

test('RescueResults: usage bar, badge and cards render', () => {
  const html = text(
    renderToString(
      React.createElement(RescueResults, {
        result,
        acceptBusy: false,
        onAccept: () => {},
        onAnother: () => {},
      }),
    ),
  );
  assert.match(html, /Использует 400 г из 400 г/);
  assert.match(html, /Весь запас/);
  assert.match(html, /Сырники/);
  assert.match(html, /Запеканка/);
  assert.match(html, /Готовлю это/);
  assert.match(html, /Спасаем: Творог/);
});

test('RescueResults: partial usage hides the badge and shows the deficit note', () => {
  const partial: RescueResponseDto = {
    ...result,
    pantryUsage: { usedGrams: 600, totalGrams: 400 },
  };
  const html = text(
    renderToString(
      React.createElement(RescueResults, {
        result: partial,
        acceptBusy: false,
        onAccept: () => {},
        onAnother: () => {},
      }),
    ),
  );
  assert.ok(!html.includes('Весь запас'), 'no badge when used > total');
  assert.match(html, /докупит/);
});

test('RescueResults: links to the recipe page with servings', () => {
  const html = text(
    renderToString(
      React.createElement(RescueResults, {
        result,
        acceptBusy: false,
        onAccept: () => {},
        onAnother: () => {},
      }),
    ),
  );
  assert.match(html, /href="\/recipe\/r1\?servings=2"/);
});

/* ---------------- RescueError ---------------- */

test('RescueError: empty-state for 422, add-link for 404', () => {
  const empty = renderToString(
    React.createElement(RescueError, { kind: 'empty', onRetry: () => {}, onAnother: () => {} }),
  );
  assert.match(empty, /Нет рецептов с этим продуктом/);

  const notFound = renderToString(
    React.createElement(RescueError, { kind: 'not-found', onRetry: () => {}, onAnother: () => {} }),
  );
  assert.match(notFound, /Продукт не найден в холодильнике/);
  assert.match(notFound, /\/fridge\/add/);
});

/* ---------------- IngredientPicker helpers ---------------- */

const item = (over: Partial<PantryItem> & { id: string; ingredientId: string }): PantryItem => ({
  householdId: 'h1',
  quantity: 1,
  unit: 'G',
  estimatedGrams: 300,
  amountStatus: 'SOME',
  priority: 'NORMAL',
  storageLocation: 'FRIDGE',
  opened: false,
  expiresAt: null,
  purchaseDate: null,
  archivedAt: null,
  notes: null,
  createdAt: '',
  updatedAt: '',
  ...over,
});

test('selectPickerChips: USE_FIRST and ≤3-day expiry are urgent, soonest first', () => {
  const now = new Date('2026-09-12T12:00:00');
  const items = [
    item({ id: '1', ingredientId: 'milk', expiresAt: '2026-09-15' }),
    item({ id: '2', ingredientId: 'tvorog', expiresAt: '2026-09-13' }),
    item({ id: '3', ingredientId: 'kefir', priority: 'USE_FIRST' as const }),
    item({ id: '4', ingredientId: 'rice', expiresAt: null }),
    item({ id: '5', ingredientId: 'pasta', expiresAt: '2026-12-01' }),
  ];
  const chips = selectPickerChips(items, now);
  assert.deepEqual(
    chips.urgent.map((i) => i.ingredientId),
    ['kefir', 'tvorog', 'milk'],
    'USE_FIRST first, then soonest expiry within the window',
  );
  assert.deepEqual(
    chips.rest.map((i) => i.ingredientId),
    ['pasta', 'rice'],
    'dated items first, no-expiry last',
  );
});

test('chipLabel: notes take precedence over the raw ingredient id', () => {
  assert.equal(
    chipLabel(item({ id: '1', ingredientId: 'mlk', notes: 'Молоко 2.5%' })),
    'Молоко 2.5%',
  );
  assert.equal(chipLabel(item({ id: '2', ingredientId: 'mlk', notes: null })), 'mlk');
});
