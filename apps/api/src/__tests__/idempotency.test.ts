// MC-010 unit tests for the Idempotency-Key guard. The guard enforces
// that POST/PUT/PATCH/DELETE carry an Idempotency-Key header; the
// real cache-backed deduplication is MC-051 work.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IdempotencyKeyGuard,
  requireIdempotencyKey,
  IDEMPOTENCY_HEADER,
} from '../common/idempotency.js';

test('requireIdempotencyKey: throws VALIDATION_ERROR on missing header', () => {
  assert.throws(
    () => requireIdempotencyKey({ headers: {} }),
    (err: unknown) => {
      const e = err as { code?: string; details?: { fields?: Record<string, string[]> } };
      assert.equal(e.code, 'VALIDATION_ERROR');
      assert.ok(e.details?.fields?.['Idempotency-Key']);
      return true;
    },
  );
});

test('requireIdempotencyKey: accepts any non-empty string ≥ 16 chars', () => {
  const ok = requireIdempotencyKey({ headers: { 'idempotency-key': 'x'.repeat(16) } });
  assert.equal(ok.length, 16);
});

test('requireIdempotencyKey: rejects keys < 16 chars', () => {
  assert.throws(
    () => requireIdempotencyKey({ headers: { 'idempotency-key': 'short' } }),
    (err: unknown) => (err as { code?: string }).code === 'VALIDATION_ERROR',
  );
});

test('IDEMPOTENCY_HEADER constant', () => {
  assert.equal(IDEMPOTENCY_HEADER, 'idempotency-key');
});

test('IdempotencyKeyGuard: returns a NestJS CanActivate function', () => {
  const guard = new IdempotencyKeyGuard();
  assert.equal(typeof guard.canActivate, 'function');
});
