// Unit tests for the P2002 target matcher (T13-A / T14-A follow-up).
// The prod smoke on 2026-09-14 caught the real shape of meta.target:
// camelCase columns arrive QUOTED — ['"userId"', 'kind',
// '"ingredientId"'] — so a bare Array.includes('ingredientId') fails
// and the intended 409 mapping degraded back into a 500.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { isUniqueConstraintOn } from '../common/prisma-errors.js';

function p2002(target: unknown): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { modelName: 'Preference', target },
  });
}

test('matches a quoted camelCase target (the real prod shape)', () => {
  const err = p2002(['"userId"', 'kind', '"ingredientId"']);
  assert.equal(isUniqueConstraintOn(err, 'ingredientId'), true);
});

test('matches an unquoted target', () => {
  const err = p2002(['email']);
  assert.equal(isUniqueConstraintOn(err, 'email'), true);
});

test('does not match a different field of the same constraint', () => {
  const err = p2002(['"userId"', 'kind', '"ingredientId"']);
  assert.equal(isUniqueConstraintOn(err, 'userId'), true);
  assert.equal(isUniqueConstraintOn(err, 'note'), false);
});

test('non-P2002 and non-Prisma errors are rejected', () => {
  const p2003 = new Prisma.PrismaClientKnownRequestError('conflict', {
    code: 'P2003',
    clientVersion: 'test',
    meta: { target: ['"ingredientId"'] },
  });
  assert.equal(isUniqueConstraintOn(p2003, 'ingredientId'), false);
  assert.equal(isUniqueConstraintOn(new Error('nope'), 'ingredientId'), false);
});

test('missing/odd meta is rejected without throwing', () => {
  const noMeta = new Prisma.PrismaClientKnownRequestError('boom', {
    code: 'P2002',
    clientVersion: 'test',
  });
  assert.equal(isUniqueConstraintOn(noMeta, 'ingredientId'), false);
  assert.equal(isUniqueConstraintOn(p2002('not-an-array'), 'ingredientId'), false);
  assert.equal(isUniqueConstraintOn(null, 'ingredientId'), false);
});
