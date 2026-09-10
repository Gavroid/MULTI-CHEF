// MC-033 — Unit tests for recipes.mappers (Prisma → package/domain).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInstructions,
  mapCategoryToGroup,
  mapRecipeRow,
  mapPantry,
  mapPreferences,
  mapYesterdayMainProtein,
  proteinKindForName,
} from '../recipes.mappers.js';
import { Prisma } from '@prisma/client';
import type { PrismaRecipeWithRelations } from '../recipes.mappers.js';

const warnMessages: string[] = [];
const logger = { warn: (msg: string) => warnMessages.push(msg) };

// --- parseInstructions ---

test('mappers: valid instructions JSON parses to steps', () => {
  const json: Prisma.JsonValue = [
    { order: 1, text: 'Нарезать лук' },
    { order: 2, text: 'Обжарить', timerMinutes: 5 },
  ];
  const steps = parseInstructions(json, logger);
  assert.deepEqual(
    steps.map((s) => s.text),
    ['Нарезать лук', 'Обжарить'],
  );
});

test('mappers: malformed instructions JSON → fallback [] + warn', () => {
  warnMessages.length = 0;
  const steps = parseInstructions('not-an-array' as unknown as Prisma.JsonValue, logger);
  assert.deepEqual(steps, []);
  assert.equal(warnMessages.length, 1);
});

test('mappers: null instructions → fallback []', () => {
  assert.deepEqual(parseInstructions(null), []);
});

test('mappers: steps missing required text field → fallback []', () => {
  const steps = parseInstructions([{ order: 1 }], logger);
  assert.deepEqual(steps, []);
});

// --- mapCategoryToGroup (keyword match, WEAK by design) ---

test('mappers: category keyword-match maps russian names', () => {
  assert.equal(mapCategoryToGroup({ name: 'Мясо и птица' }), 'MEAT');
  assert.equal(mapCategoryToGroup({ name: 'Рыба и морепродукты' }), 'FISH');
  assert.equal(mapCategoryToGroup({ name: 'Молочные продукты' }), 'DAIRY');
  assert.equal(mapCategoryToGroup({ name: 'Яйца' }), 'EGG');
  assert.equal(mapCategoryToGroup({ name: 'Крупы и макароны' }), 'GRAIN');
  assert.equal(mapCategoryToGroup({ name: 'Орехи и сухофрукты' }), 'NUTS');
  assert.equal(mapCategoryToGroup({ name: 'Овощи' }), 'VEGETABLE');
  assert.equal(mapCategoryToGroup({ name: 'Специи' }), 'SPICE');
});

test('mappers: unknown category → OTHER; null/undefined → OTHER', () => {
  assert.equal(mapCategoryToGroup({ name: 'Что-то новое' }), 'OTHER');
  assert.equal(mapCategoryToGroup(null), 'OTHER');
  assert.equal(mapCategoryToGroup(undefined), 'OTHER');
});

// --- mapRecipeRow ---

const ROW: PrismaRecipeWithRelations = {
  id: 'r1',
  title: 'Паста с грибами',
  description: null,
  imageKey: null,
  servings: 2,
  prepMinutes: 10,
  cookMinutes: 15,
  difficulty: 1,
  instructions: [
    { order: 1, text: 'Отварить пасту' },
    { order: 2, text: 'Обжарить грибы' },
  ],
  mealTypes: ['LUNCH', 'DINNER'],
  tags: ['одна сковорода'],
  requiredAppliances: ['STOVE'],
  leftoverSourceOf: [],
  chainTags: ['pasta-week'],
  ingredients: [
    {
      ingredientId: 'i_pasta',
      grams: new Prisma.Decimal(200),
      optional: false,
      substitutesFor: null,
      ingredient: {
        id: 'i_pasta',
        canonicalName: 'макароны',
        avgPriceKopecks: 1200,
        category: { name: 'Крупы и макароны' },
      },
    },
    {
      ingredientId: 'i_cream',
      grams: new Prisma.Decimal(100.5),
      optional: true,
      substitutesFor: 'i_milk',
      ingredient: {
        id: 'i_cream',
        canonicalName: 'сливки',
        avgPriceKopecks: null,
        category: { name: 'Молочные продукты' },
      },
    },
  ],
};

test('mappers: mapRecipeRow maps full row to package Recipe', () => {
  const recipe = mapRecipeRow(ROW);
  assert.equal(recipe.id, 'r1');
  assert.equal(recipe.title, 'Паста с грибами');
  assert.deepEqual(recipe.instructionsText, ['Отварить пасту', 'Обжарить грибы']);
  assert.deepEqual(recipe.mealTypes, ['LUNCH', 'DINNER']);
  assert.deepEqual(recipe.chainTags, ['pasta-week']);
  assert.equal(recipe.ingredients.length, 2);
  assert.equal(recipe.ingredients[0]!.categoryGroup, 'GRAIN');
  assert.equal(recipe.ingredients[1]!.categoryGroup, 'DAIRY');
  assert.equal(recipe.ingredients[1]!.grams, 100.5); // Decimal → number
  assert.equal(recipe.ingredients[1]!.optional, true);
});

test('mappers: mapRecipeRow with broken instructions → empty instructionsText + warn', () => {
  warnMessages.length = 0;
  const recipe = mapRecipeRow({ ...ROW, instructions: null }, logger);
  assert.deepEqual(recipe.instructionsText, []);
  assert.equal(warnMessages.length, 1);
});

test('mappers: chainTags empty and non-empty both map', () => {
  assert.deepEqual(mapRecipeRow({ ...ROW, chainTags: [] }).chainTags, []);
  assert.deepEqual(mapRecipeRow(ROW).chainTags, ['pasta-week']);
});

// --- mapPantry ---

test('mappers: mapPantry converts Decimal + normalizes priority', () => {
  const pantry = mapPantry([
    {
      ingredientId: 'a',
      estimatedGrams: new Prisma.Decimal(500.25),
      priority: 'USE_FIRST',
      expiresAt: null,
    },
    {
      ingredientId: 'b',
      estimatedGrams: new Prisma.Decimal(100),
      priority: 'STAPLE',
      expiresAt: null,
    },
    {
      ingredientId: 'c',
      estimatedGrams: new Prisma.Decimal(200),
      priority: 'NORMAL',
      expiresAt: null,
    },
  ]);
  assert.equal(pantry[0]!.priority, 'USE_FIRST');
  assert.equal(pantry[0]!.estimatedGrams, 500.25);
  assert.equal(pantry[1]!.priority, 'NORMAL'); // STAPLE → NORMAL
  assert.equal(pantry[2]!.priority, 'NORMAL');
});

// --- mapPreferences ---

test('mappers: mapPreferences splits kinds and falls back without profile', () => {
  const prefs = mapPreferences(
    [
      { kind: 'ALLERGY', ingredientId: 'i_nuts' },
      { kind: 'EXCLUDE', ingredientId: 'i_cilantro' },
      { kind: 'LOVE', ingredientId: 'i_cheese' },
      { kind: 'DISLIKE', ingredientId: 'i_fish' },
      { kind: 'LOVE', ingredientId: null }, // dropped
    ],
    null,
  );
  assert.deepEqual(prefs.excludeIngredients.sort(), ['i_cilantro', 'i_nuts']);
  assert.deepEqual(prefs.allergies, ['i_nuts']);
  assert.deepEqual(prefs.preferences, [
    { kind: 'LOVE', ingredientId: 'i_cheese' },
    { kind: 'DISLIKE', ingredientId: 'i_fish' },
  ]);
  assert.equal(prefs.dietType, 'NONE');
  assert.deepEqual(prefs.appliances, ['STOVE']);
});

test('mappers: mapPreferences uses profile dietType + appliances when present', () => {
  const prefs = mapPreferences([], { dietType: 'VEGAN', appliances: ['OVEN', 'MIXER'] });
  assert.equal(prefs.dietType, 'VEGAN');
  assert.deepEqual(prefs.appliances, ['OVEN', 'MIXER']);
});

// --- yesterdayMainProtein ---

test('mappers: protein keyword-match over ingredient names', () => {
  assert.equal(proteinKindForName('куриное филе'), 'CHICKEN');
  assert.equal(proteinKindForName('Говядина'), 'BEEF');
  assert.equal(proteinKindForName('свиная отбивная'), 'PORK');
  assert.equal(proteinKindForName('горбуша'), 'FISH');
  assert.equal(proteinKindForName('творог'), null);
});

test('mappers: main protein = biggest protein-group ingredient with keyword', () => {
  const kind = mapYesterdayMainProtein([
    { categoryGroup: 'DAIRY', name: 'сливки', grams: 100 },
    { categoryGroup: 'MEAT', name: 'куриное филе', grams: 400 },
    { categoryGroup: 'MEAT', name: 'свинина', grams: 50 },
  ]);
  assert.equal(kind, 'CHICKEN');
});

test('mappers: protein group ingredient without keyword → OTHER', () => {
  // NB: «яйцо куриное» actually matches the CHICKEN keyword — use a
  // truly keyword-free name.
  const kind = mapYesterdayMainProtein([
    { categoryGroup: 'EGG', name: 'перепелиное яйцо', grams: 120 },
  ]);
  assert.equal(kind, 'OTHER');
});

test('mappers: no protein-group ingredients → null', () => {
  const kind = mapYesterdayMainProtein([
    { categoryGroup: 'VEGETABLE', name: 'картофель', grams: 500 },
    { categoryGroup: 'GRAIN', name: 'рис', grams: 200 },
  ]);
  assert.equal(kind, null);
});
