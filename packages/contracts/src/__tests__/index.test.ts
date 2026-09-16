import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RecipeDtoSchema,
  RecipeDetailDtoSchema,
  PaginatedRecipesSchema,
  ListRecipesQuerySchema,
  TodayRecommendationDtoSchema,
  TodayRequestDtoSchema,
} from '../index.js';

// MC-033: the contracts package now carries the recipes catalog +
// recommendations/today wire schemas. MC-001 scaffold smoke is replaced
// by contract tests parsing representative payloads.

const RECIPE_DTO = {
  id: '01HMZ8X9R6K7P3WXY5T2N0V4J8',
  title: 'Куриный суп',
  description: null,
  imageKey: null,
  servings: 4,
  prepMinutes: 10,
  cookMinutes: 25,
  difficulty: 1,
  mealTypes: ['DINNER'],
  tags: ['category:SOUP'],
  requiredAppliances: ['STOVE'],
  chainTags: ['soup-week'],
};

test('RecipeDtoSchema: valid payload parses, chainTags optional', () => {
  const parsed = RecipeDtoSchema.parse(RECIPE_DTO);
  assert.equal(parsed.title, 'Куриный суп');
  const bare = RecipeDtoSchema.safeParse({ ...RECIPE_DTO, chainTags: undefined });
  assert.equal(bare.success, true);
});

test('RecipeDtoSchema: rejects bad difficulty', () => {
  const res = RecipeDtoSchema.safeParse({ ...RECIPE_DTO, difficulty: 9 });
  assert.equal(res.success, false);
});

test('RecipeDetailDtoSchema: nutrition + instructions + storageRules', () => {
  const res = RecipeDetailDtoSchema.parse({
    ...RECIPE_DTO,
    instructions: [{ order: 1, text: 'Нарезать', timerMinutes: null }],
    ingredients: [
      {
        ingredientId: '01HMZ8X9R6K7P3WXY5T2N0V4J9',
        canonicalName: 'курица (филе)',
        grams: 300,
        optional: false,
        categoryGroup: 'CHICKEN',
        substitutesFor: null,
      },
    ],
    nutrition: {
      servingCalories: 250.5,
      servingProteinG: 30,
      servingFatG: 8,
      servingCarbsG: 12,
      servingGrams: 350,
      calculationVersion: 1,
    },
    storageRules: [
      {
        storageMethod: 'FRIDGE_ONLY',
        maxHoursFridge: 48,
        maxDaysFreezer: null,
        freezingAllowed: false,
        partialPrepAllowed: true,
        addBeforeServing: [],
      },
    ],
  });
  assert.equal(res.nutrition.servingGrams, 350);
});

test('PaginatedRecipesSchema: items + null cursor', () => {
  const res = PaginatedRecipesSchema.parse({ items: [RECIPE_DTO], nextCursor: null });
  assert.equal(res.items.length, 1);
  assert.equal(res.nextCursor, null);
});

test('ListRecipesQuerySchema: defaults + bounds', () => {
  const empty = ListRecipesQuerySchema.parse({});
  assert.equal(empty.limit, 20);
  const bad = ListRecipesQuerySchema.safeParse({ limit: 51 });
  assert.equal(bad.success, false);
  const meal = ListRecipesQuerySchema.safeParse({ mealType: 'BRUNCH' });
  assert.equal(meal.success, false);
});

test('TodayRequestDtoSchema: defaults on empty body', () => {
  const parsed = TodayRequestDtoSchema.parse({});
  assert.equal(parsed.generationSettings, undefined);
  const withSettings = TodayRequestDtoSchema.parse({
    generationSettings: { maxMinutes: 30, antiFilters: ['NO_OVEN'], rescueIngredientId: null },
  });
  assert.equal(withSettings.generationSettings?.maxMinutes, 30);
  const bad = TodayRequestDtoSchema.safeParse({ generationSettings: { maxMinutes: 0 } });
  assert.equal(bad.success, false);
});

test('TodayRecommendationDtoSchema: 3 options, ESTIMATED accuracy', () => {
  const option = {
    type: 'FROM_PANTRY',
    recipe: RECIPE_DTO,
    score: 0.87,
    explanation: 'Куриный суп · 3 продукта уже дома',
    toBuyCount: 2,
    chainTag: null,
  };
  const best = {
    type: 'BEST_MATCH',
    recipe: RECIPE_DTO,
    score: 0.91,
    explanation: 'Куриный суп · лучший баланс',
  };
  const chain = {
    type: 'CHAIN',
    recipe: RECIPE_DTO,
    score: 0.72,
    explanation: 'Цепочка: soup-week',
    chainTag: 'soup-week',
    chain: [RECIPE_DTO, RECIPE_DTO],
  };
  const res = TodayRecommendationDtoSchema.parse({
    options: [option, best, chain],
    nutritionAccuracy: 'ESTIMATED',
    generatedAt: '2026-09-10T10:00:00.000Z',
  });
  assert.equal(res.options.length, 3);
  const badAccuracy = TodayRecommendationDtoSchema.safeParse({
    options: [option, best, chain],
    nutritionAccuracy: 'EXACT',
    generatedAt: '2026-09-10T10:00:00.000Z',
  });
  assert.equal(badAccuracy.success, false);
  // NB: option ORDER (FROM_PANTRY, BEST_MATCH, CHAIN) is a service-level
  // guarantee, not a schema-level one (zod discriminated union validates
  // each option independently). Order is covered by pick-top3 unit tests
  // and the controller integration spec.
});

// T54-B (audit round 54, P1): imageKey — только внутренние пути
// сид-хранилища; data:/http(s)/javascript: отклоняются контрактом.
test('RecipeDtoSchema.imageKey: rejects non-internal sources (XSS)', () => {
  const base = { ...RECIPE_DTO };
  for (const evil of [
    'data:text/html;base64,PHNjcmlwdD4=',
    'javascript:alert(1)',
    'https://evil.example.com/x.webp',
    '/images/recipes/x.svg',
    '/etc/passwd.webp',
  ]) {
    const result = RecipeDtoSchema.safeParse({ ...base, imageKey: evil });
    assert.equal(result.success, false, `must reject: ${evil}`);
  }
});

test('RecipeDtoSchema.imageKey: accepts opaque storage keys (T54-C, E24)', () => {
  // catalog keys and household upload keys both start with recipes/
  for (const key of [
    'recipes/tolokno-s-lukom-poreem.webp',
    'recipes/u/01hfakehousehold0000000000/3b8ad9a0-12cd-4e01-a333-000000000001.jpg',
  ]) {
    const result = RecipeDtoSchema.safeParse({ ...RECIPE_DTO, imageKey: key });
    assert.equal(result.success, true, `should accept ${key}`);
  }
});

test('RecipeDtoSchema.imageKey: nullable is preserved', () => {
  assert.equal(RecipeDtoSchema.safeParse({ ...RECIPE_DTO, imageKey: null }).success, true);
});
