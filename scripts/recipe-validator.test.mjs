// Unit tests for scripts/lib/recipe-validator.mjs (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCard, buildTags, slugify } from './lib/recipe-validator.mjs';

const catalog = new Map([
  ['курица', { id: '1', unit: 'G' }],
  ['рис', { id: '2', unit: 'G' }],
  ['морковь', { id: '3', unit: 'G' }],
  ['лук репчатый', { id: '4', unit: 'G' }],
  ['соль', { id: '5', unit: 'G' }],
]);
const nutrition = new Map([
  ['курица', { kcal: 165, protein: 20, fat: 9, carbs: 0 }],
  ['рис', { kcal: 344, protein: 7, fat: 1, carbs: 76 }],
  ['морковь', { kcal: 35, protein: 1.3, fat: 0.1, carbs: 8 }],
  ['лук репчатый', { kcal: 41, protein: 1.1, fat: 0.1, carbs: 9 }],
  ['соль', { kcal: 0, protein: 0, fat: 0, carbs: 0 }],
]);

const steps = [
  'Промойте курицу (400 г), обсушите бумажным полотенцем и нарежьте кубиками примерно 2 см.',
  'Отварите рис (200 г) в подсоленной воде 15 минут до готовности, затем откиньте на сито.',
  'Обжарьте курицу на сковороде 7 минут при среднем нагреве, добавьте морковь и лук.',
  'Соедините всё, тушите под крышкой 10 минут при 180 градусах.',
  'Подавайте горячим, примерно 300 г на порцию.',
];

function happy(overrides = {}) {
  return {
    title: 'Курица с рисом и морковью',
    description:
      'Сытное домашнее блюдо из курицы с рисом и морковью — готовится в одной кастрюле за 40 минут.',
    category: 'MAIN',
    cuisines: ['русская'],
    seasons: ['ALL_YEAR'],
    diets: ['GLUTEN_FREE'],
    mealTypes: ['LUNCH', 'DINNER'],
    difficulty: 1,
    servings: 2,
    prepMinutes: 10,
    cookMinutes: 30,
    ingredients: [
      { ingredient: 'курица', quantity: 400, unit: 'G', grams: 400 },
      { ingredient: 'рис', quantity: 150, unit: 'G', grams: 150 },
      { ingredient: 'морковь', quantity: 100, unit: 'G', grams: 100 },
      { ingredient: 'лук репчатый', quantity: 80, unit: 'G', grams: 80 },
      { ingredient: 'соль', quantity: 5, unit: 'G', grams: 5 },
    ],
    instructions: steps,
    ...overrides,
  };
}

const ctx = { catalog, nutrition, seenTitles: new Set() };

test('happy card passes and computes per-serving facts', () => {
  const card = happy();
  const r = validateCard(card, ctx);
  assert.deepEqual(r.errors, [], r.errors);
  assert.equal(r.ok, true);
  assert.ok(card._perServing.kcal >= 120 && card._perServing.kcal <= 1200);
});

test('duplicate title detected via seenTitles', () => {
  const c = ctx;
  validateCard(happy(), c);
  const r = validateCard(happy({ title: 'курица с рисом и морковью' }), c);
  assert.ok(r.errors.includes('FIELD:title.duplicate'));
});

test('unknown ingredient rejected', () => {
  const r = validateCard(
    happy({
      ingredients: happy().ingredients.map((i) =>
        i.ingredient === 'соль'
          ? { ingredient: 'несуществующий', quantity: 5, unit: 'G', grams: 5 }
          : i,
      ),
    }),
    { ...ctx, seenTitles: new Set() },
  );
  assert.ok(r.errors.some((e) => e.startsWith('ING:unknown')));
});

test('portion below 100g flagged', () => {
  const r = validateCard(
    happy({
      ingredients: happy().ingredients.map((i) => ({ ...i, grams: 20, quantity: 20 })),
    }),
    { ...ctx, seenTitles: new Set() },
  );
  assert.ok(r.errors.some((e) => e.startsWith('PORTION:')));
});

test('drink kcal range differs from mains', () => {
  const r = validateCard(
    happy({
      title: 'Компот из ягод',
      category: 'DRINK',
      mealTypes: ['SNACK'],
    }),
    { ...ctx, seenTitles: new Set() },
  );
  // порция напитка считается по 150–400 и низкие ккал не ломают правило напитков
  assert.ok(!r.errors.some((e) => e === 'KCAL:macroMismatch'), r.errors);
});

test('too few steps flagged', () => {
  const r = validateCard(happy({ instructions: steps.slice(0, 3) }), {
    ...ctx,
    seenTitles: new Set(),
  });
  assert.ok(r.errors.includes('STEPS:tooFew'));
});

test('short instructions flagged', () => {
  const r = validateCard(
    happy({
      instructions: [
        'Разогрейте духовку до 180.',
        'Смешайте всё в миске.',
        'Выложите в форму.',
        'Запеките до готовности.',
      ],
    }),
    { ...ctx, seenTitles: new Set() },
  );
  assert.ok(r.errors.some((e) => e.startsWith('STEPS:tooShort')));
});

test('kcal out of range for mains flagged', () => {
  const r = validateCard(
    happy({
      ingredients: happy().ingredients.map((i) =>
        i.ingredient === 'соль' ? { ingredient: 'соль', quantity: 1, unit: 'G', grams: 1 } : i,
      ),
      servings: 12,
    }),
    { ...ctx, seenTitles: new Set() },
  );
  assert.ok(
    r.errors.some((e) => e.startsWith('KCAL') || e.startsWith('PORTION')),
    r.errors,
  );
});

test('buildTags follows seed convention', () => {
  const tags = buildTags(happy());
  assert.equal(tags[0], 'category:MAIN');
  assert.ok(tags.includes('cuisine:русская'));
  assert.ok(tags.includes('diet:GLUTEN_FREE'));
});

test('slugify transliterates cyrillic', () => {
  assert.equal(slugify('Сырники классические'), 'syrniki-klassicheskie');
});

// MC-200 stage 3: NaN/undefined leaked into step text by the generator
// template must hard-fail validation (PLAN-2000-RECIPES §5.3).
test('validateCard rejects NaN/undefined in step text', () => {
  const badSteps = [...steps];
  badSteps[0] = 'Взбейте 4 яйца (NaN г) с молоком (undefined г) и щепоткой соли.';
  const r = validateCard(happy({ instructions: badSteps }), { ...ctx, seenTitles: new Set() });
  assert.ok(
    r.errors.some((e) => e.startsWith('STEPS:nanOrUndefined')),
    r.errors,
  );
  assert.equal(r.ok, false);
});
