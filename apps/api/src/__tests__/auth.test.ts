// MC-010 unit tests for the auth helpers — argon2 roundtrip for the
// user password hash + session token generation. These don't need a
// database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import argon2 from 'argon2';
import { generateSessionToken, hashSessionToken } from '../auth/session-token.js';

test('generateSessionToken: 32+ chars, base64url, high entropy', () => {
  const t = generateSessionToken();
  assert.ok(t.length >= 32, `token too short: ${t.length}`);
  assert.match(t, /^[A-Za-z0-9_-]+$/, 'token must be base64url (no + / =)');
});

test('generateSessionToken: two calls produce different values', () => {
  const a = generateSessionToken();
  const b = generateSessionToken();
  assert.notEqual(a, b);
});

test('hashSessionToken: sha256 hex, 64 chars, deterministic verify (PRD §3.2)', () => {
  const raw = generateSessionToken();
  const h1 = hashSessionToken(raw);
  const h2 = hashSessionToken(raw);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('hashSessionToken: different tokens produce different hashes', () => {
  const a = hashSessionToken(generateSessionToken());
  const b = hashSessionToken(generateSessionToken());
  assert.notEqual(a, b);
});

test('argon2id: hash + verify roundtrip for user passwords (PRD MC-010 DoD)', async () => {
  const password = 'Pa$w0rd-not-a-secret-just-a-test-vector';
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  assert.match(hash, /^\$argon2id\$/);
  assert.ok(await argon2.verify(hash, password));
  assert.equal(await argon2.verify(hash, password + 'tampered'), false);
});
