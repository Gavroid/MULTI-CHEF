// PROD-001/002 fix (2026-09-30) — unit tests for shopping-list path
// param schemas. Worker creates composite ids (`{planId}-list`,
// `{listId}-{ingredientId}`); the old strict ULID schemas rejected
// every real request (400 VALIDATION_ERROR on live prod).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ShoppingListIdParamsSchema,
  ShoppingListItemIdParamsSchema,
} from '../shopping-lists/shopping-lists.dto.js';

const REAL_LIST_ID = 'a5725d09-62a3-4a58-9f3e-e28d7de5fec8-list';
const REAL_ITEM_ID = '7b0c1fad-1ab1-43e1-a46e-3d2b6c0ed6ac-list-AB3BC74F54FCE31EFAC42EDE9B';
const ULID_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

test('composite list id {planId}-list is accepted', () => {
  const r = ShoppingListIdParamsSchema.safeParse({ id: REAL_LIST_ID });
  assert.equal(r.success, true);
});

test('ULID list id is still accepted (backward compat)', () => {
  const r = ShoppingListIdParamsSchema.safeParse({ id: ULID_ID });
  assert.equal(r.success, true);
});

test('composite item id {listId}-{ingredientId} is accepted', () => {
  const r = ShoppingListItemIdParamsSchema.safeParse({ itemId: REAL_ITEM_ID });
  assert.equal(r.success, true);
});

test('garbage ids are rejected (form validation intact)', () => {
  assert.equal(ShoppingListIdParamsSchema.safeParse({ id: 'x' }).success, false);
  assert.equal(ShoppingListIdParamsSchema.safeParse({ id: 'bad id with spaces!!' }).success, false);
  assert.equal(ShoppingListItemIdParamsSchema.safeParse({ itemId: '' }).success, false);
});

test('strict schemas reject unknown keys', () => {
  assert.equal(ShoppingListIdParamsSchema.safeParse({ id: ULID_ID, extra: 1 }).success, false);
});
