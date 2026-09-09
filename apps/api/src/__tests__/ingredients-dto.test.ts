// MC-021 — Unit tests for the ingredients catalog query / response
// DTO schemas. Tests target the raw zod schemas so the runner doesn't
// have to resolve `nestjs-zod` (which pulls in rxjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IngredientsQuerySchema,
  IngredientsCategoryQuerySchema,
  IngredientsNutritionParamsSchema,
  IngredientSortField,
  IngredientSortOrder,
} from '../ingredients/ingredients.dto.js';

test('IngredientsQuerySchema: empty query → defaults (limit=50, offset=0, sort=canonicalName, order=asc)', () => {
  const r = IngredientsQuerySchema.safeParse({});
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.limit, 50);
    assert.equal(r.data.offset, 0);
    assert.equal(r.data.sort, 'canonicalName');
    assert.equal(r.data.order, 'asc');
  }
});

test('IngredientsQuerySchema: limit bounds (1..100), rejects 0 and 101', () => {
  assert.equal(IngredientsQuerySchema.safeParse({ limit: '1' }).success, true);
  assert.equal(IngredientsQuerySchema.safeParse({ limit: '100' }).success, true);
  assert.equal(IngredientsQuerySchema.safeParse({ limit: '0' }).success, false);
  assert.equal(IngredientsQuerySchema.safeParse({ limit: '101' }).success, false);
});

test('IngredientsQuerySchema: offset must be ≥ 0', () => {
  assert.equal(IngredientsQuerySchema.safeParse({ offset: '0' }).success, true);
  assert.equal(IngredientsQuerySchema.safeParse({ offset: '1000' }).success, true);
  assert.equal(IngredientsQuerySchema.safeParse({ offset: '-1' }).success, false);
});

test('IngredientsQuerySchema: sort accepts only known enum values', () => {
  assert.equal(IngredientsQuerySchema.safeParse({ sort: 'canonicalName' }).success, true);
  assert.equal(IngredientsQuerySchema.safeParse({ sort: 'avgPriceKopecks' }).success, true);
  assert.equal(IngredientsQuerySchema.safeParse({ sort: 'createdAt' }).success, false);
  assert.equal(IngredientsQuerySchema.safeParse({ sort: 'id' }).success, false);
});

test('IngredientsQuerySchema: order accepts asc|desc only', () => {
  assert.equal(IngredientsQuerySchema.safeParse({ order: 'asc' }).success, true);
  assert.equal(IngredientsQuerySchema.safeParse({ order: 'desc' }).success, true);
  assert.equal(IngredientsQuerySchema.safeParse({ order: 'ASC' }).success, false);
  assert.equal(IngredientsQuerySchema.safeParse({ order: 'sideways' }).success, false);
});

test('IngredientsQuerySchema: coerces string→number for limit/offset', () => {
  const r = IngredientsQuerySchema.safeParse({ limit: '25', offset: '5' });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(typeof r.data.limit, 'number');
    assert.equal(r.data.limit, 25);
    assert.equal(r.data.offset, 5);
  }
});

test('IngredientsQuerySchema: trims q and category whitespace', () => {
  const r = IngredientsQuerySchema.safeParse({ q: '  пом  ', category: '  VEGETABLE  ' });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.q, 'пом');
    assert.equal(r.data.category, 'VEGETABLE');
  }
});

test('IngredientsQuerySchema: rejects empty q after trim, accepts 1..100', () => {
  assert.equal(IngredientsQuerySchema.safeParse({ q: '' }).success, false);
  assert.equal(IngredientsQuerySchema.safeParse({ q: '   ' }).success, false);
  assert.equal(IngredientsQuerySchema.safeParse({ q: 'x' }).success, true);
  // 101-char q is rejected
  const longQ = 'x'.repeat(101);
  assert.equal(IngredientsQuerySchema.safeParse({ q: longQ }).success, false);
});

test('IngredientsQuerySchema: rejects empty category after trim', () => {
  assert.equal(IngredientsQuerySchema.safeParse({ category: '' }).success, false);
  assert.equal(IngredientsQuerySchema.safeParse({ category: '   ' }).success, false);
  // categories are short — max 50 chars
  assert.equal(IngredientsQuerySchema.safeParse({ category: 'x'.repeat(51) }).success, false);
});

test('IngredientsQuerySchema: multiple invalid params → aggregate issues', () => {
  const r = IngredientsQuerySchema.safeParse({ limit: '999', sort: 'wrong', order: 'wrong' });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.ok(r.error.issues.length >= 3);
    const paths = r.error.issues.map((i) => i.path.join('.'));
    assert.ok(paths.includes('limit'));
    assert.ok(paths.includes('sort'));
    assert.ok(paths.includes('order'));
  }
});

test('IngredientsCategoryQuerySchema: empty object passes; rejects extra unknown fields (strict)', () => {
  // Empty query is fine (id is optional).
  assert.equal(IngredientsCategoryQuerySchema.safeParse({}).success, true);
  // The schema is `.strict()` — unknown fields are rejected.
  assert.equal(IngredientsCategoryQuerySchema.safeParse({ extra: 'x' }).success, false);
  // `id` accepts any non-empty string (we don't enforce ULID here
  // because the route is a list endpoint and id is unused for now).
  assert.equal(IngredientsCategoryQuerySchema.safeParse({ id: 'foo' }).success, true);
});

test('IngredientsNutritionParamsSchema: id is required ULID', () => {
  assert.equal(IngredientsNutritionParamsSchema.safeParse({ id: 'abc' }).success, false);
  const ULID = '01HMZ8X9R6K7P3WXY5T2N0V4J8';
  assert.equal(IngredientsNutritionParamsSchema.safeParse({ id: ULID }).success, true);
});

test('IngredientSortField + IngredientSortOrder are exported', () => {
  // Smoke check the enums are exported as const arrays (used by
  // @nestjs/swagger ApiQuery choices).
  assert.ok(Array.isArray(IngredientSortField));
  assert.ok(IngredientSortField.includes('canonicalName'));
  assert.ok(IngredientSortField.includes('avgPriceKopecks'));
  assert.ok(Array.isArray(IngredientSortOrder));
  assert.ok(IngredientSortOrder.includes('asc'));
  assert.ok(IngredientSortOrder.includes('desc'));
});
