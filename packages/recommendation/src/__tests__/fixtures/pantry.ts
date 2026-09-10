// MC-032 — Pantry fixtures: 4 scenarios (ADR §6.1).

import type { PantryItem } from '../../types.js';

const DAY = 24 * 60 * 60 * 1000;
/** Fixed "today" for all fixtures: 2026-09-10T10:00:00Z. */
export const NOW = new Date('2026-09-10T10:00:00Z');

/** Everything the pasta recipe needs, plus urgent mushrooms. */
export const PANTRY_FULL: PantryItem[] = [
  { ingredientId: 'ing_pasta', estimatedGrams: 500, priority: 'NORMAL' },
  { ingredientId: 'ing_mushroom', estimatedGrams: 400, priority: 'USE_FIRST' },
  { ingredientId: 'ing_cream', estimatedGrams: 200, priority: 'NORMAL' },
];

/** Nothing at home. */
export const PANTRY_EMPTY: PantryItem[] = [];

/** Only mushrooms (partial match). */
export const PANTRY_PARTIAL: PantryItem[] = [
  { ingredientId: 'ing_mushroom', estimatedGrams: 400, priority: 'NORMAL' },
];

/** Items expiring within 3 days of NOW. */
export const PANTRY_URGENT: PantryItem[] = [
  {
    ingredientId: 'ing_tomato',
    estimatedGrams: 300,
    priority: 'NORMAL',
    expiresAt: new Date(NOW.getTime() + 1 * DAY),
  },
  {
    ingredientId: 'ing_cucumber',
    estimatedGrams: 200,
    priority: 'NORMAL',
    expiresAt: new Date(NOW.getTime() + 2 * DAY),
  },
  {
    ingredientId: 'ing_oil',
    estimatedGrams: 500,
    priority: 'NORMAL',
    expiresAt: new Date(NOW.getTime() + 90 * DAY),
  },
  {
    ingredientId: 'ing_chicken',
    estimatedGrams: 600,
    priority: 'USE_FIRST',
    expiresAt: new Date(NOW.getTime() + 30 * DAY),
  },
];
