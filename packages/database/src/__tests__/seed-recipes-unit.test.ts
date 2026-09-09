// MC-031 — Unit tests for the recipe seed catalog.
//
// These tests exercise the seed DATA + pure helpers WITHOUT touching a
// database. DB behaviour is covered by seed-recipes-integration.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INGREDIENTS } from '../seed/ingredients.js';
import { RECIPES, CHAIN_TAGS, buildRecipeTags, storageRuleData } from '../seed/recipes/index.js';
import type { RecipeSeed } from '../seed/recipes/types.js';

const KNOWN_INGREDIENT_NAMES = new Set(INGREDIENTS.map((i) => i.canonicalName));

const VALID_CATEGORIES = ['BREAKFAST', 'SOUP', 'MAIN', 'SALAD', 'SIDE', 'DESSERT', 'BEVERAGE'];
const VALID_DIFFICULTIES = ['BEGINNER', 'CONFIDENT', 'EXPERIMENTER'];
const VALID_MEAL_TYPES = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];
const VALID_APPLIANCES = ['STOVE', 'OVEN', 'MICROWAVE', 'MULTICOOKER', 'BLENDER', 'MIXER'];
const VALID_SEASONS = ['SUMMER', 'WINTER', 'ALL_YEAR'];
const VALID_DIETS = ['VEGETARIAN', 'VEGAN', 'GLUTEN_FREE', 'POST'];
const VALID_UNITS = ['G', 'ML', 'PIECE'];

test('RECIPES: at least 200 unique canonicalTitles (DoD #1)', () => {
  assert.ok(RECIPES.length >= 200, `expected ≥200 recipes, got ${RECIPES.length}`);
  const titles = RECIPES.map((r) => r.canonicalTitle);
  assert.equal(new Set(titles).size, titles.length, 'duplicate canonicalTitle found');
});

test('RECIPES: each recipe has 3-12 ingredients', () => {
  for (const r of RECIPES) {
    assert.ok(
      r.ingredients.length >= 3 && r.ingredients.length <= 12,
      `"${r.canonicalTitle}" has ${r.ingredients.length} ingredients`,
    );
  }
});

test('RECIPES: no orphan ingredient references (all in MC-020 catalog)', () => {
  for (const r of RECIPES) {
    for (const ing of r.ingredients) {
      assert.ok(
        KNOWN_INGREDIENT_NAMES.has(ing.canonicalName),
        `"${r.canonicalTitle}" references unknown ingredient "${ing.canonicalName}"`,
      );
    }
  }
});

test('RECIPES: instructions have 4-12 steps each', () => {
  for (const r of RECIPES) {
    assert.ok(
      r.instructions.length >= 4 && r.instructions.length <= 12,
      `"${r.canonicalTitle}" has ${r.instructions.length} instructions`,
    );
  }
});

test('RECIPES: nutrition present with kcal > 0 and others >= 0', () => {
  for (const r of RECIPES) {
    const n = r.nutrition;
    assert.ok(n, `"${r.canonicalTitle}" has no nutrition`);
    assert.ok(n.kcal > 0, `"${r.canonicalTitle}" kcal must be > 0, got ${n.kcal}`);
    assert.ok(n.proteinG >= 0, `"${r.canonicalTitle}" proteinG must be >= 0`);
    assert.ok(n.fatG >= 0, `"${r.canonicalTitle}" fatG must be >= 0`);
    assert.ok(n.carbsG >= 0, `"${r.canonicalTitle}" carbsG must be >= 0`);
  }
});

test('CHAIN_TAGS: at least 20 chains, each with at least 2 recipes', () => {
  assert.ok(CHAIN_TAGS.length >= 20, `expected ≥20 chains, got ${CHAIN_TAGS.length}`);
  const titles = new Set(RECIPES.map((r) => r.canonicalTitle));
  const slugs = new Set<string>();
  for (const chain of CHAIN_TAGS) {
    assert.ok(chain.titles.length >= 2, `chain "${chain.slug}" has <2 recipes`);
    assert.ok(!slugs.has(chain.slug), `duplicate chain slug: ${chain.slug}`);
    slugs.add(chain.slug);
    for (const t of chain.titles) {
      assert.ok(titles.has(t), `chain "${chain.slug}" references unknown recipe "${t}"`);
    }
  }
});

test('RECIPES: category distribution hits the required ranges', () => {
  const counts = new Map<string, number>();
  for (const r of RECIPES) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const n = (c: string) => counts.get(c) ?? 0;
  // завтраки 30-50, супы ~40, основные 80-120, салаты+гарниры ~60, десерты ~30, напитки ~20
  assert.ok(n('BREAKFAST') >= 30 && n('BREAKFAST') <= 50, `BREAKFAST=${n('BREAKFAST')}`);
  assert.ok(n('SOUP') >= 30 && n('SOUP') <= 50, `SOUP=${n('SOUP')}`);
  assert.ok(n('MAIN') >= 80 && n('MAIN') <= 120, `MAIN=${n('MAIN')}`);
  assert.ok(n('SALAD') >= 20, `SALAD=${n('SALAD')}`);
  assert.ok(n('SIDE') >= 10, `SIDE=${n('SIDE')}`);
  assert.ok(n('DESSERT') >= 20, `DESSERT=${n('DESSERT')}`);
  assert.ok(n('BEVERAGE') >= 15, `BEVERAGE=${n('BEVERAGE')}`);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  assert.equal(total, RECIPES.length);
});

test('RECIPES: all enum-like fields hold valid values', () => {
  for (const r of RECIPES) {
    assert.ok(
      VALID_CATEGORIES.includes(r.category),
      `"${r.canonicalTitle}" bad category ${r.category}`,
    );
    assert.ok(
      VALID_DIFFICULTIES.includes(r.difficulty),
      `"${r.canonicalTitle}" bad difficulty ${r.difficulty}`,
    );
    for (const m of r.mealTypes) {
      assert.ok(VALID_MEAL_TYPES.includes(m), `"${r.canonicalTitle}" bad mealType ${m}`);
    }
    for (const a of r.requiredAppliances) {
      assert.ok(VALID_APPLIANCES.includes(a), `"${r.canonicalTitle}" bad appliance ${a}`);
    }
    for (const s of r.seasonTags) {
      assert.ok(VALID_SEASONS.includes(s), `"${r.canonicalTitle}" bad season ${s}`);
    }
    for (const d of r.dietTags) {
      assert.ok(VALID_DIETS.includes(d), `"${r.canonicalTitle}" bad diet ${d}`);
    }
    for (const ing of r.ingredients) {
      assert.ok(VALID_UNITS.includes(ing.unit), `"${r.canonicalTitle}" bad unit ${ing.unit}`);
      assert.ok(
        Number.isFinite(ing.quantityG) && ing.quantityG > 0,
        `"${r.canonicalTitle}" bad quantity ${ing.quantityG} for ${ing.canonicalName}`,
      );
    }
    assert.ok(r.servings >= 1 && r.servings <= 12, `"${r.canonicalTitle}" bad servings`);
    assert.ok(r.prepMinutes >= 0 && r.prepMinutes <= 120, `"${r.canonicalTitle}" bad prepMinutes`);
    assert.ok(r.cookMinutes >= 0 && r.cookMinutes <= 240, `"${r.canonicalTitle}" bad cookMinutes`);
    assert.ok(r.cuisineTags.length > 0, `"${r.canonicalTitle}" has no cuisine tag`);
  }
});

test('buildRecipeTags: category first, then cuisine/season/diet prefixes', () => {
  const sample: RecipeSeed = {
    canonicalTitle: 'Тест',
    category: 'MAIN',
    servings: 2,
    prepMinutes: 10,
    cookMinutes: 20,
    difficulty: 'BEGINNER',
    cuisineTags: ['русская'],
    mealTypes: ['LUNCH'],
    requiredAppliances: [],
    seasonTags: ['ALL_YEAR'],
    dietTags: ['VEGETARIAN'],
    instructions: ['a', 'b', 'c', 'd'],
    ingredients: [
      { canonicalName: 'вода', quantityG: 100, unit: 'ML', optional: false },
      { canonicalName: 'соль', quantityG: 1, unit: 'G', optional: false },
      { canonicalName: 'сахар', quantityG: 1, unit: 'G', optional: true },
    ],
    nutrition: { kcal: 10, proteinG: 1, fatG: 1, carbsG: 1 },
  };
  const tags = buildRecipeTags(sample);
  assert.deepEqual(tags, [
    'category:MAIN',
    'cuisine:русская',
    'season:ALL_YEAR',
    'diet:VEGETARIAN',
  ]);
});

test('storageRuleData: derives method from freezer days, null when absent', () => {
  const base = {
    canonicalTitle: 'Тест',
    category: 'MAIN' as const,
    servings: 2,
    prepMinutes: 10,
    cookMinutes: 20,
    difficulty: 'BEGINNER' as const,
    cuisineTags: ['русская'],
    mealTypes: ['LUNCH' as const],
    requiredAppliances: [],
    seasonTags: ['ALL_YEAR' as const],
    dietTags: [],
    instructions: ['a', 'b', 'c', 'd'],
    ingredients: [
      { canonicalName: 'вода', quantityG: 100, unit: 'ML' as const, optional: false },
      { canonicalName: 'соль', quantityG: 1, unit: 'G' as const, optional: false },
      { canonicalName: 'сахар', quantityG: 1, unit: 'G' as const, optional: true },
    ],
    nutrition: { kcal: 10, proteinG: 1, fatG: 1, carbsG: 1 },
  };
  assert.equal(storageRuleData(base), null);
  const frozen = storageRuleData({
    ...base,
    storageRule: { shelfDaysFridge: 3, shelfDaysFreezer: 60, containerType: 'PLASTIC' },
  });
  assert.ok(frozen);
  assert.equal(frozen.storageMethod, 'FREEZE_OK');
  assert.equal(frozen.maxHoursFridge, 72);
  assert.equal(frozen.maxDaysFreezer, 60);
  const fridgeOnly = storageRuleData({
    ...base,
    storageRule: { shelfDaysFridge: 2, shelfDaysFreezer: 0, containerType: 'GLASS' },
  });
  assert.ok(fridgeOnly);
  assert.equal(fridgeOnly.storageMethod, 'FRIDGE_ONLY');
});
