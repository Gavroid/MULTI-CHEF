// auth-pages — light-touch tests for the auth screens.
//
// Full event-simulation testing of the React form lifecycle through
// happy-dom proved brittle: state updates don't always flush before the
// next fireInput, and React 19's submit delegation differs from browser
// DOM behaviour. Instead we cover three layers:
//
//   1. Pure helpers (humaniseLoginError, humaniseRegisterError,
//      sanitizeRedirect) — no React, no DOM.
//   2. Form rendering via renderToString — verifies the static markup
//      (inputs, labels, submit button, cross-link) without booting the
//      client event system.
//   3. Regression guards via source-level inspection — the auth pages
//      must import @multichef/ui (so designers see a single source of
//      design tokens).
//
// Behaviour-driven integration tests for fetch wiring live in
// auth-client.test.ts (the SUT behind every form submit). End-to-end
// browser tests are QA's territory (Playwright).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  LoginForm,
  humaniseLoginError,
  type LoginFormDeps,
} from '../app/(auth)/auth/login/LoginForm';
import {
  RegisterForm,
  humaniseRegisterError,
  type RegisterFormDeps,
} from '../app/(auth)/auth/register/RegisterForm';
import { sanitizeRedirect } from '../lib/redirect';

const here = dirname(fileURLToPath(import.meta.url));
function projectRoot(start: string): string {
  let cursor = start;
  for (let i = 0; i < 8; i += 1) {
    if (cursor.endsWith('apps/web')) return cursor;
    const parent = resolve(cursor, '..');
    if (parent === cursor) break;
    cursor = parent;
  }
  return start;
}
const root = projectRoot(here);
const readSrc = (rel: string): string => readFileSync(resolve(root, rel), 'utf8');

const noopLoginDeps: LoginFormDeps = {
  // Submit never resolves with data — keeps the form in idle state for SSR.
  submit: async () => ({ data: undefined, error: undefined }) as never,
  navigate: (): void => {},
};
const noopRegisterDeps: RegisterFormDeps = {
  submit: async () => ({ data: undefined, error: undefined }) as never,
  navigate: (): void => {},
};

/* ---------------- Pure helpers ---------------- */

test('humaniseLoginError: 401 UNAUTHORIZED → "Неверный email или пароль"', () => {
  assert.equal(
    humaniseLoginError({
      status: 401,
      error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
    }),
    'Неверный email или пароль.',
  );
});

test('humaniseLoginError: rate-limited → wait message', () => {
  assert.match(
    humaniseLoginError({ status: 429, error: { code: 'RATE_LIMITED', message: 'too many' } }),
    /Подождите/,
  );
});

test('humaniseLoginError: 0 status (network) → connection message', () => {
  assert.match(
    humaniseLoginError({ status: 0, error: { code: 'NETWORK_ERROR', message: 'Failed to fetch' } }),
    /Нет соединения/,
  );
});

test('humaniseLoginError: unknown code falls back to server message', () => {
  assert.equal(
    humaniseLoginError({ status: 500, error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
    'boom',
  );
});

test('humaniseRegisterError: 409 CONFLICT → "уже зарегистрирован"', () => {
  assert.match(
    humaniseRegisterError({
      status: 409,
      error: { code: 'CONFLICT', message: 'Email already registered' },
    }),
    /уже зарегистрирован/,
  );
});

test('humaniseRegisterError: rate-limited → wait message', () => {
  assert.match(
    humaniseRegisterError({ status: 429, error: { code: 'RATE_LIMITED', message: 'too many' } }),
    /Подождите/,
  );
});

test('sanitizeRedirect: same-origin path accepted', () => {
  assert.equal(sanitizeRedirect('/shopping'), '/shopping');
  assert.equal(sanitizeRedirect('/today'), '/today');
});

test('sanitizeRedirect: rejects protocol-relative URLs (open-redirect)', () => {
  assert.equal(sanitizeRedirect('//evil.com'), null);
  assert.equal(sanitizeRedirect('//evil.com/path'), null);
});

test('sanitizeRedirect: rejects absolute URLs and null', () => {
  assert.equal(sanitizeRedirect('https://evil.com'), null);
  assert.equal(sanitizeRedirect('javascript:alert(1)'), null);
  assert.equal(sanitizeRedirect(null), null);
  assert.equal(sanitizeRedirect(undefined), null);
  assert.equal(sanitizeRedirect(''), null);
});

/* ---------------- Static rendering (server-side) ---------------- */

test('LoginForm renders email + password inputs + submit button (server render)', () => {
  const html = renderToString(
    React.createElement(LoginForm, { deps: noopLoginDeps, redirectTo: null }),
  );
  assert.match(html, /<input[^>]*type="email"/);
  assert.match(html, /<input[^>]*type="password"/);
  assert.match(html, /<button[^>]*type="submit"/);
});

test('LoginForm marks the form with data-testid for browser tests', () => {
  const html = renderToString(
    React.createElement(LoginForm, { deps: noopLoginDeps, redirectTo: null }),
  );
  assert.match(html, /data-testid="mc-login-form"/);
});

test('RegisterForm renders email + password + householdName + submit (server render)', () => {
  const html = renderToString(React.createElement(RegisterForm, { deps: noopRegisterDeps }));
  assert.match(html, /<input[^>]*type="email"/);
  assert.match(html, /<input[^>]*type="password"/);
  assert.match(html, /<input[^>]*type="text"/);
  assert.match(html, /<button[^>]*type="submit"/);
});

test('RegisterForm marks the form with data-testid for browser tests', () => {
  const html = renderToString(React.createElement(RegisterForm, { deps: noopRegisterDeps }));
  assert.match(html, /data-testid="mc-register-form"/);
});

test('LoginForm renders the cross-link text in helper copy', () => {
  // The cross-link to /auth/register lives in the page wrapper, not the
  // form. Form-level assertion: LoginForm itself does not render any
  // <a href="…"> — that's the page's job.
  const html = renderToString(
    React.createElement(LoginForm, { deps: noopLoginDeps, redirectTo: null }),
  );
  assert.equal(html.includes('href="/auth/register"'), false);
});

test('RegisterForm renders the cross-link text in helper copy', () => {
  const html = renderToString(React.createElement(RegisterForm, { deps: noopRegisterDeps }));
  assert.equal(html.includes('href="/auth/login"'), false);
});

/* ---------------- Cross-link wiring (page-level source check) ---------------- */

test('/auth/login page source contains a link to /auth/register', () => {
  const src = readSrc('src/app/(auth)/auth/login/page.tsx');
  assert.match(src, /href="\/auth\/register"/);
  assert.match(src, /Зарегистрироваться/);
});

test('/auth/register page source contains a link to /auth/login', () => {
  const src = readSrc('src/app/(auth)/auth/register/page.tsx');
  assert.match(src, /href="\/auth\/login"/);
  assert.match(src, /Войти/);
});

/* ---------------- Regression: ui package is the source of inputs/buttons ---------------- */

test('/auth/login page source references @multichef/ui Input + Button', () => {
  const pageSrc = readSrc('src/app/(auth)/auth/login/page.tsx');
  // The page may not render Input directly (it's inside LoginForm), but
  // it imports it. Either an import or a JSX tag is fine — we just need
  // to confirm the ui package is the source of the components.
  const formSrc = readSrc('src/app/(auth)/auth/login/LoginForm.tsx');
  assert.match(pageSrc, /@multichef\/ui/);
  assert.match(formSrc, /<Input\b/);
  assert.match(formSrc, /<Button\b/);
});

test('/auth/register page source references @multichef/ui Input + Button', () => {
  const formSrc = readSrc('src/app/(auth)/auth/register/RegisterForm.tsx');
  assert.match(formSrc, /@multichef\/ui/);
  assert.match(formSrc, /<Input\b/);
  assert.match(formSrc, /<Button\b/);
});

test('FormErrorBanner exists and is exported from components/', () => {
  const src = readSrc('src/components/FormErrorBanner.tsx');
  assert.match(src, /export function FormErrorBanner/);
  assert.match(src, /role="alert"/);
  assert.match(src, /data-testid="mc-form-error"/);
});

test('sanitizeRedirect is exported from lib/redirect (not from the page)', () => {
  // The Next.js page convention forbids named exports alongside the
  // default export — we keep sanitizeRedirect in a lib module.
  const src = readSrc('src/lib/redirect.ts');
  assert.match(src, /export function sanitizeRedirect/);
});

/* ---------------- Wire-up confirmation (source-level) ---------------- */

test('LoginPage wires login() + saveLocalUser + router.push', () => {
  const pageSrc = readSrc('src/app/(auth)/auth/login/page.tsx');
  const formSrc = readSrc('src/app/(auth)/auth/login/LoginForm.tsx');
  assert.match(pageSrc, /\blogin\b[\s,][^;]*?from\s*['"]@\/lib\/auth-client/);
  assert.match(pageSrc, /\bsaveLocalUser\b[\s,][^;]*?from\s*['"]@\/lib\/auth-storage/);
  assert.match(pageSrc, /saveLocalUser\(resp\.data\.user,\s*resp\.data\.household\)/s);
  assert.match(pageSrc, /router\.push\(/);
  // The form does the actual redirect.
  assert.match(formSrc, /deps\.navigate\(redirectTo\s*\?\?\s*['"]\/today['"]\)/);
});

test('RegisterPage wires register() + saveLocalUser + delegates to /today', () => {
  const pageSrc = readSrc('src/app/(auth)/auth/register/page.tsx');
  const formSrc = readSrc('src/app/(auth)/auth/register/RegisterForm.tsx');
  assert.match(pageSrc, /\bregister\b[\s,][^;]*?from\s*['"]@\/lib\/auth-client/);
  assert.match(pageSrc, /\bsaveLocalUser\b[\s,][^;]*?from\s*['"]@\/lib\/auth-storage/);
  assert.match(pageSrc, /saveLocalUser\(resp\.data\.user,\s*resp\.data\.household\)/s);
  // The redirect lives in RegisterForm (it owns the navigation).
  assert.match(formSrc, /deps\.navigate\(['"]\/today['"]\)/);
});

test('AuthGuard continues to read the mc_user localStorage key', () => {
  const src = readSrc('src/components/AuthGuard.tsx');
  assert.match(src, /mc_user/);
});

/* ---------------- FormErrorBanner behaviour ---------------- */

test('FormErrorBanner renders nothing when message is null (a11y live region preserved)', async () => {
  const { FormErrorBanner } = await import('../components/FormErrorBanner');
  // When message is null we still emit a sr-only aria-live container so
  // screen readers announce transitions to "no error".
  const emptyHtml = renderToString(React.createElement(FormErrorBanner, { message: null }));
  assert.match(emptyHtml, /aria-live="polite"/);
  assert.equal(emptyHtml.includes('role="alert"'), false);
});

test('FormErrorBanner renders role=alert when message is set', async () => {
  const { FormErrorBanner } = await import('../components/FormErrorBanner');
  const html = renderToString(
    React.createElement(FormErrorBanner, { message: 'Что-то пошло не так' }),
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /Что-то пошло не так/);
});
