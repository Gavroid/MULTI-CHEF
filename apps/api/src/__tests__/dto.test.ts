// MC-010 unit tests for the DTO schemas. Each test exercises the
// validation rules at the boundary so we catch schema regressions
// without spinning up Postgres.
//
// We import the *raw zod schemas* (not the `nestjs-zod` DTO classes)
// so this file is loadable in test environments where the rxjs
// peer-dep hasn't been hoisted into the test runner's resolution
// path. The DTO classes are thin wrappers over these schemas.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoginBody, RegisterBody } from '../auth/auth.dto.js';

test('RegisterBody: accepts a valid payload', () => {
  const r = RegisterBody.safeParse({
    email: 'A@example.com',
    password: 'correct horse battery staple',
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.email, 'a@example.com');
});

test('RegisterBody: rejects invalid email', () => {
  const r = RegisterBody.safeParse({ email: 'not-an-email', password: 'something' });
  assert.equal(r.success, false);
});

test('RegisterBody: rejects short password', () => {
  const r = RegisterBody.safeParse({ email: 'a@b.com', password: 'short' });
  assert.equal(r.success, false);
});

test('RegisterBody: rejects unknown extra fields (strict)', () => {
  const r = RegisterBody.safeParse({
    email: 'a@b.com',
    password: 'something',
    isAdmin: true,
  });
  assert.equal(r.success, false);
});

test('RegisterBody: accepts guestProfile with peopleCount', () => {
  const r = RegisterBody.safeParse({
    email: 'a@b.com',
    password: 'something',
    guestProfile: { peopleCount: 4 },
  });
  assert.equal(r.success, true);
});

test('LoginBody: rejects missing email', () => {
  const r = LoginBody.safeParse({ password: 'something' });
  assert.equal(r.success, false);
});

test('LoginBody: lowercases the email', () => {
  const r = LoginBody.safeParse({ email: 'A@Example.Com', password: 'p' });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.email, 'a@example.com');
});
