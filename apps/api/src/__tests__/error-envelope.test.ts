// MC-010 unit tests for the global exception filter. The filter
// translates NestJS / library errors into the { error: { code, ... } }
// envelope from docs/api/conventions.md §2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toErrorBody } from '../common/error-envelope.js';

test('toErrorBody: VALIDATION_ERROR uses 400', () => {
  const body = toErrorBody({ code: 'VALIDATION_ERROR', message: 'bad input' });
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.equal(body.error.message, 'bad input');
  assert.equal(body.status, 400);
});

test('toErrorBody: UNAUTHORIZED uses 401, FORBIDDEN uses 403', () => {
  assert.equal(toErrorBody({ code: 'UNAUTHORIZED' }).status, 401);
  assert.equal(toErrorBody({ code: 'FORBIDDEN' }).status, 403);
});

test('toErrorBody: NOT_FOUND uses 404, CONFLICT uses 409', () => {
  assert.equal(toErrorBody({ code: 'NOT_FOUND' }).status, 404);
  assert.equal(toErrorBody({ code: 'CONFLICT' }).status, 409);
});

test('toErrorBody: RATE_LIMITED uses 429, INTERNAL_ERROR uses 500', () => {
  assert.equal(toErrorBody({ code: 'RATE_LIMITED' }).status, 429);
  assert.equal(toErrorBody({ code: 'INTERNAL_ERROR' }).status, 500);
});

test('toErrorBody: unknown code falls back to 500', () => {
  assert.equal(toErrorBody({ code: 'WAT' }).status, 500);
});

test('toErrorBody: passes through requestId', () => {
  const body = toErrorBody({
    code: 'NOT_FOUND',
    message: 'gone',
    requestId: 'req_01HABC',
  });
  assert.equal(body.error.requestId, 'req_01HABC');
});

test('toErrorBody: trims password out of details (no plaintext leak)', () => {
  const body = toErrorBody({
    code: 'VALIDATION_ERROR',
    message: 'bad',
    details: { password: 'Pa$w0rd!', email: 'a@b.com' },
  });
  const details = body.error.details as { password: string; email: string };
  assert.equal(details.password, '[REDACTED]');
  assert.equal(details.email, 'a@b.com');
});
