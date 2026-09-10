// MC-033 — Unit tests for the CSRF double-submit guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CsrfDoubleSubmitGuard } from '../common/csrf-guard.js';
import { AppHttpException } from '../common/exception-filter.js';

function ctx(method: string, cookies: Record<string, string>, headers: Record<string, string>) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, cookies, headers }),
    }),
  } as never;
}

test('csrf: safe methods always pass', () => {
  const guard = new CsrfDoubleSubmitGuard();
  assert.equal(guard.canActivate(ctx('GET', { mc_csrf: 'aaa' }, {})), true);
  assert.equal(guard.canActivate(ctx('HEAD', { mc_csrf: 'aaa' }, {})), true);
  assert.equal(guard.canActivate(ctx('OPTIONS', {}, {})), true);
});

test('csrf: no csrf cookie → allow (non-browser client)', () => {
  const guard = new CsrfDoubleSubmitGuard();
  assert.equal(guard.canActivate(ctx('POST', {}, {})), true);
});

test('csrf: cookie + matching header → allow', () => {
  const guard = new CsrfDoubleSubmitGuard();
  assert.equal(guard.canActivate(ctx('POST', { mc_csrf: 'tok' }, { 'x-csrf-token': 'tok' })), true);
});

test('csrf: cookie + missing header → 403', () => {
  const guard = new CsrfDoubleSubmitGuard();
  assert.throws(
    () => guard.canActivate(ctx('POST', { mc_csrf: 'tok' }, {})),
    (err: unknown) => err instanceof AppHttpException,
  );
});

test('csrf: cookie + wrong header → 403', () => {
  const guard = new CsrfDoubleSubmitGuard();
  assert.throws(
    () => guard.canActivate(ctx('PATCH', { mc_csrf: 'tok' }, { 'x-csrf-token': 'other' })),
    (err: unknown) => err instanceof AppHttpException,
  );
});

test('csrf: empty cookie value → allow', () => {
  const guard = new CsrfDoubleSubmitGuard();
  assert.equal(guard.canActivate(ctx('POST', { mc_csrf: '' }, {})), true);
});
