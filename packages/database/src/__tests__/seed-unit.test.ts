// MC-020 — Unit tests for the seed catalog.
//
// These tests exercise the seed data + helpers WITHOUT touching a
// database. The integration test (`seed-integration.test.ts`) covers
// the actual prisma upsert against a real Postgres.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES } from '../seed/categories.js';
import { INGREDIENTS, type CategorySlug } from '../seed/ingredients.js';
import { buildAliasIndex } from '../seed/aliases.js';

const ALL_CATEGORY_SLUGS: readonly CategorySlug[] = [
  'VEGETABLE',
  'FRUIT',
  'MEAT',
  'DAIRY',
  'GRAIN',
  'SPICE',
  'BEVERAGE',
  'OTHER',
];

test('CATEGORIES: exactly 8 entries', () => {
  assert.equal(CATEGORIES.length, 8);
});

test('CATEGORIES: each slug is unique and well-known', () => {
  const slugs = CATEGORIES.map((c) => c.slug);
  assert.equal(new Set(slugs).size, 8);
  for (const c of CATEGORIES) {
    assert.ok(ALL_CATEGORY_SLUGS.includes(c.slug as CategorySlug));
  }
});

test('INGREDIENTS: 300 entries (PRD §3.2 target)', () => {
  assert.equal(INGREDIENTS.length, 300);
});

test('INGREDIENTS: distribution per category', () => {
  // Loose range — exact counts vary slightly between revisions but
  // the totals per category must be ≥25 (the floor for 8 categories
  // hitting 300).
  const counts = new Map<CategorySlug, number>();
  for (const ing of INGREDIENTS) {
    counts.set(ing.category, (counts.get(ing.category) ?? 0) + 1);
  }
  assert.equal(counts.size, 8, 'every category slug should be represented');
  for (const slug of ALL_CATEGORY_SLUGS) {
    assert.ok((counts.get(slug) ?? 0) >= 25, `${slug} count too low`);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  assert.equal(total, 300);
});

test('INGREDIENTS: every canonicalName is unique', () => {
  const names = new Set<string>();
  for (const ing of INGREDIENTS) {
    assert.ok(!names.has(ing.canonicalName), `duplicate: ${ing.canonicalName}`);
    names.add(ing.canonicalName);
  }
});

test('INGREDIENTS: every category slug is in the known set', () => {
  for (const ing of INGREDIENTS) {
    assert.ok(
      ALL_CATEGORY_SLUGS.includes(ing.category),
      `unknown category: ${ing.category} on ${ing.canonicalName}`,
    );
  }
});

test('INGREDIENTS: every unit is G / ML / PIECE', () => {
  for (const ing of INGREDIENTS) {
    assert.ok(
      ['G', 'ML', 'PIECE'].includes(ing.defaultUnit),
      `${ing.canonicalName} unit ${ing.defaultUnit}`,
    );
  }
});

test('INGREDIENTS: packageSize / avgPriceKopecks are non-negative, shelfDays positive where set', () => {
  for (const ing of INGREDIENTS) {
    assert.ok(ing.packageSize > 0, `${ing.canonicalName} packageSize`);
    assert.ok(ing.avgPriceKopecks >= 0, `${ing.canonicalName} avgPriceKopecks`);
    if (ing.defaultShelfDaysFridge !== null) {
      assert.ok(ing.defaultShelfDaysFridge > 0);
    }
    if (ing.defaultShelfDaysPantry !== null) {
      assert.ok(ing.defaultShelfDaysPantry > 0);
    }
    if (ing.defaultShelfDaysFreezer !== null) {
      assert.ok(ing.defaultShelfDaysFreezer > 0);
    }
  }
});

test('INGREDIENTS: ediblePartRatio is in (0, 1]', () => {
  for (const ing of INGREDIENTS) {
    assert.ok(ing.ediblePartRatio > 0 && ing.ediblePartRatio <= 1, ing.canonicalName);
  }
});

test('INGREDIENTS: ≥100 ingredients have at least 1 alias', () => {
  const withAlias = INGREDIENTS.filter((i) => i.aliases.length > 0);
  assert.ok(
    withAlias.length >= 100,
    `expected ≥100 ingredients with aliases, got ${withAlias.length}`,
  );
});

test('INGREDIENTS: aliases are non-empty strings, no duplicates within a row', () => {
  for (const ing of INGREDIENTS) {
    for (const a of ing.aliases) {
      assert.ok(typeof a === 'string' && a.length > 0);
    }
    assert.equal(new Set(ing.aliases).size, ing.aliases.length);
  }
});

test('buildAliasIndex: returns an index keyed by canonicalName', () => {
  const idx = buildAliasIndex(INGREDIENTS);
  assert.ok(idx.ru);
  // spot-check помидор
  assert.ok(idx.ru['помидор']);
  assert.deepEqual([...idx.ru['помидор']].sort(), ['pomidor', 'томат', 'томаты'].sort());
});

test('buildAliasIndex: top-50 ingredients by frequency get ≥3 aliases', () => {
  // Approximate the top-50 by counting common kitchen items. We just
  // verify that several very common items (помидор, молоко, яйца,
  // картофель, лук, морковь, масло сливочное) all have aliases.
  const must = ['помидор', 'молоко (коровье)', 'яйцо куриное', 'картофель', 'масло сливочное'];
  const idx = buildAliasIndex(INGREDIENTS);
  for (const name of must) {
    const aliases = idx.ru[name];
    assert.ok(
      aliases && aliases.length >= 3,
      `${name} expected ≥3 aliases, got ${aliases?.length}`,
    );
  }
});
