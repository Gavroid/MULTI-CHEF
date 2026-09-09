// MC-022 — Unit tests for the Pantry DTO schemas. Tests target the
// raw zod schemas so the runner doesn't have to resolve `nestjs-zod`.
//
// Schema reality (MC-003, not modifiable in MC-022):
//   PantryItem has no `notes`, no `archivedAt`. We accept only fields
//   that map to real columns. `notes` and `archivedAt` are dropped.
//   `?sort=addedAt` is rejected (no such column); we accept `createdAt`
//   instead. `unit`, `quantity`, `estimatedGrams`, `amountStatus`,
//   `storageLocation` are NOT NULL schema columns; the DTO defaults
//   them to safe values so the API doesn't break the schema.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CreatePantryItemSchema,
  PatchPantryItemSchema,
  ListPantryQuerySchema,
  PantryItemIdParamsSchema,
  RestorePantryItemParamsSchema,
  PANTRY_SORT_FIELDS,
} from '../pantry/pantry.dto.js';

const ULID = '01HMZ8X9R6K7P3WXY5T2N0V4J8';

test('CreatePantryItemSchema: ingredientId must be ULID', () => {
  assert.equal(
    CreatePantryItemSchema.safeParse({ ingredientId: 'abc', quantityG: 100 }).success,
    false,
  );
  const r = CreatePantryItemSchema.safeParse({ ingredientId: ULID, quantityG: 100 });
  assert.equal(r.success, true);
});

test('CreatePantryItemSchema: quantityG must be > 0', () => {
  assert.equal(
    CreatePantryItemSchema.safeParse({ ingredientId: ULID, quantityG: 0 }).success,
    false,
  );
  assert.equal(
    CreatePantryItemSchema.safeParse({ ingredientId: ULID, quantityG: -1 }).success,
    false,
  );
  assert.equal(
    CreatePantryItemSchema.safeParse({ ingredientId: ULID, quantityG: 0.01 }).success,
    true,
  );
});

test('CreatePantryItemSchema: accepts ISO date for expiresAt', () => {
  const r = CreatePantryItemSchema.safeParse({
    ingredientId: ULID,
    quantityG: 100,
    expiresAt: '2026-12-31',
  });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(typeof r.data.expiresAt, 'string');
  }
});

test('CreatePantryItemSchema: rejects unknown extra fields (strict)', () => {
  assert.equal(
    CreatePantryItemSchema.safeParse({
      ingredientId: ULID,
      quantityG: 100,
      sneaky: 'x',
    }).success,
    false,
  );
});

test('CreatePantryItemSchema: defaults unit=G, amountStatus=SOME, storageLocation=FRIDGE, priority=NORMAL, opened=false', () => {
  const r = CreatePantryItemSchema.safeParse({ ingredientId: ULID, quantityG: 100 });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.unit, 'G');
    assert.equal(r.data.amountStatus, 'SOME');
    assert.equal(r.data.storageLocation, 'FRIDGE');
    assert.equal(r.data.priority, 'NORMAL');
    assert.equal(r.data.opened, false);
  }
});

test('PatchPantryItemSchema: all fields optional', () => {
  const r = PatchPantryItemSchema.safeParse({});
  assert.equal(r.success, true);
  // quantityG must still be > 0 when present
  assert.equal(PatchPantryItemSchema.safeParse({ quantityG: 0 }).success, false);
  assert.equal(PatchPantryItemSchema.safeParse({ quantityG: 50 }).success, true);
});

test('ListPantryQuerySchema: defaults sort=createdAt, order=desc, limit=50, offset=0, includeArchived=false', () => {
  const r = ListPantryQuerySchema.safeParse({});
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.sort, 'createdAt');
    assert.equal(r.data.order, 'desc');
    assert.equal(r.data.limit, 50);
    assert.equal(r.data.offset, 0);
    assert.equal(r.data.includeArchived, false);
  }
});

test('ListPantryQuerySchema: sort enum validates allowed fields', () => {
  assert.equal(ListPantryQuerySchema.safeParse({ sort: 'createdAt' }).success, true);
  assert.equal(ListPantryQuerySchema.safeParse({ sort: 'expiresAt' }).success, true);
  assert.equal(ListPantryQuerySchema.safeParse({ sort: 'quantityG' }).success, true);
  // addedAt is NOT a schema column — should reject.
  assert.equal(ListPantryQuerySchema.safeParse({ sort: 'addedAt' }).success, false);
  // unknown fields rejected
  assert.equal(ListPantryQuerySchema.safeParse({ sort: 'name' }).success, false);
});

test('ListPantryQuerySchema: coerces string→number for limit/offset', () => {
  const r = ListPantryQuerySchema.safeParse({ limit: '10', offset: '5' });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.limit, 10);
    assert.equal(r.data.offset, 5);
  }
});

test('ListPantryQuerySchema: limit bounds 1..100', () => {
  assert.equal(ListPantryQuerySchema.safeParse({ limit: '0' }).success, false);
  assert.equal(ListPantryQuerySchema.safeParse({ limit: '101' }).success, false);
  assert.equal(ListPantryQuerySchema.safeParse({ limit: '50' }).success, true);
});

test('PantryItemIdParamsSchema: id is ULID', () => {
  assert.equal(PantryItemIdParamsSchema.safeParse({ id: 'abc' }).success, false);
  assert.equal(PantryItemIdParamsSchema.safeParse({ id: ULID }).success, true);
});

test('RestorePantryItemParamsSchema: id is ULID', () => {
  assert.equal(RestorePantryItemParamsSchema.safeParse({ id: 'abc' }).success, false);
  assert.equal(RestorePantryItemParamsSchema.safeParse({ id: ULID }).success, true);
});

test('PANTRY_SORT_FIELDS exported as readonly tuple', () => {
  assert.ok(Array.isArray(PANTRY_SORT_FIELDS));
  assert.ok(PANTRY_SORT_FIELDS.includes('createdAt'));
  assert.ok(PANTRY_SORT_FIELDS.includes('expiresAt'));
  assert.ok(PANTRY_SORT_FIELDS.includes('quantityG'));
});

test('CreatePantryItemSchema: notes is optional', () => {
  const r = CreatePantryItemSchema.safeParse({ ingredientId: ULID, quantityG: 100 });
  assert.equal(r.success, true);
});

test('CreatePantryItemSchema: notes accepts 1..500 chars (after trim)', () => {
  assert.equal(
    CreatePantryItemSchema.safeParse({ ingredientId: ULID, quantityG: 100, notes: 'x' }).success,
    true,
  );
  assert.equal(
    CreatePantryItemSchema.safeParse({
      ingredientId: ULID,
      quantityG: 100,
      notes: 'x'.repeat(500),
    }).success,
    true,
  );
});

test('CreatePantryItemSchema: notes length 501 → reject', () => {
  assert.equal(
    CreatePantryItemSchema.safeParse({
      ingredientId: ULID,
      quantityG: 100,
      notes: 'x'.repeat(501),
    }).success,
    false,
  );
});

test('CreatePantryItemSchema: notes is trimmed', () => {
  const r = CreatePantryItemSchema.safeParse({
    ingredientId: ULID,
    quantityG: 100,
    notes: '   hello   ',
  });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.notes, 'hello');
  }
});

test('PatchPantryItemSchema: notes is optional + nullable', () => {
  // All fields absent
  assert.equal(PatchPantryItemSchema.safeParse({}).success, true);
  // null clears notes
  const r1 = PatchPantryItemSchema.safeParse({ notes: null });
  assert.equal(r1.success, true);
  if (r1.success) assert.equal(r1.data.notes, null);
  // string sets it
  const r2 = PatchPantryItemSchema.safeParse({ notes: 'updated' });
  assert.equal(r2.success, true);
  if (r2.success) assert.equal(r2.data.notes, 'updated');
});

test('PatchPantryItemSchema: notes length 501 → reject', () => {
  assert.equal(PatchPantryItemSchema.safeParse({ notes: 'x'.repeat(501) }).success, false);
});
