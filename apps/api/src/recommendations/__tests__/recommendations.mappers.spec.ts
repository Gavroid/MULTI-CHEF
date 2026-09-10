// MC-033 — Unit tests for recommendations.mappers (protein/pantry/prefs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchYesterdayMainProtein, mapYesterdayMainProtein } from '../recommendations.mappers.js';
import { Prisma } from '@prisma/client';
import { NOW } from './fixtures.js';

test('mappers: yesterday protein from DINNER entry (chicken)', async () => {
  const prisma = {
    mealPlanDay: {
      findFirst: async () => ({
        entries: [
          {
            recipe: {
              ingredients: [
                {
                  grams: new Prisma.Decimal(400),
                  optional: false,
                  ingredient: { canonicalName: 'куриное филе', category: { name: 'Мясо и птица' } },
                },
                {
                  grams: new Prisma.Decimal(100),
                  optional: false,
                  ingredient: { canonicalName: 'сливки', category: { name: 'Молочные продукты' } },
                },
              ],
            },
          },
        ],
      }),
    },
  };
  const kind = await fetchYesterdayMainProtein(prisma as never, 'hh1', NOW);
  assert.equal(kind, 'CHICKEN');
});

test('mappers: no plan yesterday → null (NOT_CHICKEN_AGAIN no-op)', async () => {
  const prisma = {
    mealPlanDay: {
      findFirst: async () => null,
    },
  };
  const kind = await fetchYesterdayMainProtein(prisma as never, 'hh1', NOW);
  assert.equal(kind, null);
});

test('mappers: fish dinner detected over dairy', async () => {
  const prisma = {
    mealPlanDay: {
      findFirst: async () => ({
        entries: [
          {
            recipe: {
              ingredients: [
                {
                  grams: new Prisma.Decimal(300),
                  optional: false,
                  ingredient: { canonicalName: 'горбуша', category: { name: 'Рыба' } },
                },
                {
                  grams: new Prisma.Decimal(80),
                  optional: false,
                  ingredient: { canonicalName: 'сыр', category: { name: 'Сыры' } },
                },
              ],
            },
          },
        ],
      }),
    },
  };
  const kind = await fetchYesterdayMainProtein(prisma as never, 'hh1', NOW);
  assert.equal(kind, 'FISH');
});

test('mappers: mapYesterdayMainProtein direct — grams DESC decides main', () => {
  const kind = mapYesterdayMainProtein([
    { categoryGroup: 'FISH', name: 'креветки', grams: 50 },
    { categoryGroup: 'MEAT', name: 'говядина', grams: 450 },
  ]);
  assert.equal(kind, 'BEEF');
});
