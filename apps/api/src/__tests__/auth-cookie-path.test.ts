// R20 F8: session/csrf cookies must use Path=/ so the browser sends
// them on page navigations (middleware + SW precache depend on it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE_PATH } from '../auth/auth.controller.js';

test('auth cookies use Path=/ (R20 F8)', () => {
  assert.equal(COOKIE_PATH, '/');
});
