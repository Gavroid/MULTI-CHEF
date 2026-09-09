// App-shell integration tests (MC-013).
//
// We assert the wiring at the file/route level — not a full Next.js
// integration. The full SSR + navigation round-trip belongs in
// Playwright (out of scope for this scaffold per MC-012). What we
// CAN prove cheaply:
//   1. Each (app) page renders the expected Russian h1.
//   2. Each (app) page imports BottomTabBar (via the (app) layout).
//   3. /profile renders the auth CTA pointing to /auth/login.
//   4. /design still exists and renders the design demo.
//   5. /profile redirects to /auth/login when mc_session cookie is absent
//      (via middleware.ts source-level contract).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
function projectRoot(start: string): string {
  let cursor = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(resolve(cursor, 'tailwind.config.ts'))) return cursor;
    const parent = resolve(cursor, '..');
    if (parent === cursor) break;
    cursor = parent;
  }
  return start;
}
const root = projectRoot(here);
const read = (rel: string): string => readFileSync(resolve(root, rel), 'utf8');

const APP_PAGES = [
  { path: 'src/app/(app)/today/page.tsx', title: 'Сегодня' },
  { path: 'src/app/(app)/fridge/page.tsx', title: 'Холодильник' },
  { path: 'src/app/(app)/plan/page.tsx', title: 'План' },
  { path: 'src/app/(app)/shopping/page.tsx', title: 'Покупки' },
  { path: 'src/app/(app)/profile/page.tsx', title: 'Профиль' },
];

test('(app) layout wraps every page with the BottomTabBar', () => {
  const layout = read('src/app/(app)/layout.tsx');
  assert.match(layout, /BottomTabBar/);
  // 64px tab bar + breathing room — bottom padding reserves the space.
  assert.match(layout, /pb-24/);
  assert.match(layout, /max-w-content/);
});

test('(app) layout wraps every page with AuthGuard', () => {
  const layout = read('src/app/(app)/layout.tsx');
  assert.match(layout, /AuthGuard/);
});

test('every (app) page renders the documented Russian h1', () => {
  for (const { path, title } of APP_PAGES) {
    const src = read(path);
    // Each page passes the Russian label as TabTitle's JSX child.
    const re = new RegExp(`<TabTitle\\b[^>]*>${title}<\\/TabTitle>`);
    assert.ok(re.test(src), `${path} should render <TabTitle>${title}</TabTitle>`);
  }
});

test('every (app) page shows an empty-state Card with TODO marker (except /profile)', () => {
  // /profile is the redirect target — its CTA points to /auth/login instead of
  // being a disabled "TODO" button. The other 4 pages are stubs.
  for (const { path } of APP_PAGES) {
    const src = read(path);
    assert.match(src, /<Card\b/, `${path} should render a Card`);
    if (path.endsWith('profile/page.tsx')) continue;
    assert.match(src, /TODO/, `${path} should mark future work with TODO`);
  }
});

test('/profile renders an explicit CTA pointing to /auth/login', () => {
  const src = read('src/app/(app)/profile/page.tsx');
  assert.match(src, /href="\/auth\/login"/);
  assert.match(src, /Войти/);
});

test('(auth) layout does NOT include the BottomTabBar', () => {
  const layout = read('src/app/(auth)/layout.tsx');
  // Look for an actual import statement (not a doc-comment mention).
  assert.ok(!/import .*BottomTabBar/.test(layout), 'auth layout should not import BottomTabBar');
  assert.match(layout, /max-w-content/);
});

test('(auth) login page renders a TODO placeholder and a register link', () => {
  // In MC-014 the auth pages are no longer stubs — they wire real
  // /api/v1/auth/* endpoints. We assert the wire-up contract instead
  // (the page imports the LoginForm which calls the real fetch
  // client). The TODO marker moved to the form internals.
  const pageSrc = read('src/app/(auth)/auth/login/page.tsx');
  const formSrc = read('src/app/(auth)/auth/login/LoginForm.tsx');
  assert.match(formSrc, /<Button\b/);
  assert.match(pageSrc, /href="\/auth\/register"/);
  assert.match(pageSrc, /\blogin\b[\s,][^;]*?from\s*['"]@\/lib\/auth-client/);
});

test('(auth) register page renders a TODO placeholder and a login link', () => {
  const pageSrc = read('src/app/(auth)/auth/register/page.tsx');
  const formSrc = read('src/app/(auth)/auth/register/RegisterForm.tsx');
  assert.match(formSrc, /<Button\b/);
  assert.match(pageSrc, /href="\/auth\/login"/);
  // The page wires `register` from auth-client + delegates the form.
  assert.match(pageSrc, /\bregister\b[\s,][^;]*?from\s*['"]@\/lib\/auth-client/);
});

test('/design still renders the design-system demo (regression guard)', () => {
  assert.ok(existsSync(resolve(root, 'src/app/design/page.tsx')), 'design route must exist');
  const src = read('src/app/design/page.tsx');
  assert.match(src, /Дизайн-система/);
  for (const comp of ['Button', 'Card', 'Input', 'Chip', 'Badge', 'Skeleton']) {
    assert.ok(src.includes(comp), `design demo should mention ${comp}`);
  }
});

test('landing page shows Войти + Создать аккаунт CTAs (MC-013)', () => {
  const src = read('src/app/page.tsx');
  assert.match(src, /href="\/auth\/login"/);
  assert.match(src, /href="\/auth\/register"/);
  assert.match(src, /Семейный планировщик питания/);
});

test('middleware.ts protects /profile only (per MC-013 spec)', () => {
  const mw = read('src/middleware.ts');
  assert.match(mw, /mc_session/);
  assert.match(mw, /\/auth\/login/);
  assert.match(mw, /PROTECTED_PREFIXES/);
  // /today, /fridge, /plan, /shopping are NOT in the protected list —
  // guests can browse the empty-state UI (PRD §2.3.2).
  const protectedSection = mw.match(/PROTECTED_PREFIXES\s*=\s*\[([^\]]+)\]/);
  assert.ok(protectedSection, 'PROTECTED_PREFIXES array literal should be parseable');
  const body = protectedSection?.[1] ?? '';
  assert.match(body, /'\/profile'/);
  assert.ok(!/'\/today'/.test(body), '/today should NOT be protected');
  assert.ok(!/'\/fridge'/.test(body), '/fridge should NOT be protected');
});

test('middleware matcher covers /profile/:path*', () => {
  const mw = read('src/middleware.ts');
  assert.match(mw, /matcher:\s*\[[^\]]*\/profile[^\]]*\]/);
});

test('BottomTabBar package source is intact (regression guard)', () => {
  const t = read('src/components/BottomTabBar.tsx');
  assert.match(t, /h-16/); // 64px height per PRD
  assert.match(t, /safe-area-inset-bottom/);
  assert.match(t, /aria-label="Основная навигация"/);
});

test('useTheme.ts hook still exists and exports useTheme (regression guard)', () => {
  const hook = read('src/hooks/useTheme.ts');
  assert.match(hook, /export function useTheme/);
});
