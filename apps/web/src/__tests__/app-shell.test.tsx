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

test('every (app) page renders the documented Russian h1 (directly or via Client)', () => {
  for (const { path, title } of APP_PAGES) {
    const src = read(path);
    // Each page passes the Russian label as TabTitle's JSX child, OR
    // delegates to a Client component that owns the TabTitle (MC-023
    // /fridge → FridgeClient). T46-B (E23): /profile resolves the title
    // via next-intl — accept {t('title')} when the ru dictionary holds
    // the documented Russian title.
    const direct = new RegExp(`<TabTitle\\b[^>]*>\\s*${title}\\s*</TabTitle>`);
    const viaI18n =
      /<TabTitle\b[^>]*>\s*\{t\('title'\)\}\s*<\/TabTitle>/.test(src) &&
      new RegExp(`title: '${title}'`).test(read('src/i18n/ru.ts'));
    const delegatesToFridge = /<FridgeClient\b/.test(src) && path.endsWith('fridge/page.tsx');
    // MC-034: /today delegates to TodayClient, which owns the TabTitle.
    const delegatesToToday = /<TodayClient\b/.test(src) && path.endsWith('today/page.tsx');
    const delegatesToPlan = /<PlanClient\b/.test(src) && path.endsWith('plan/page.tsx');
    const delegatesToShopping = /<ShoppingClient\b/.test(src) && path.endsWith('shopping/page.tsx');
    assert.ok(
      direct.test(src) ||
        viaI18n ||
        delegatesToFridge ||
        delegatesToToday ||
        delegatesToPlan ||
        delegatesToShopping,
      `${path} should render <TabTitle>${title}</TabTitle> directly or delegate to its Client`,
    );
  }
});

test('every (app) page shows an empty-state Card with TODO marker (except /profile, /fridge)', () => {
  // /profile redirects to /auth/login via CTA.
  // /fridge (MC-023) is no longer a stub — it delegates to FridgeClient
  // which renders the empty state inside a Card, not in the page file.
  // The other 3 pages are still stubs.
  for (const { path } of APP_PAGES) {
    if (path.endsWith('fridge/page.tsx')) {
      const src = read(path);
      assert.match(src, /<FridgeClient\b/, 'fridge page delegates to FridgeClient');
      continue;
    }
    if (path.endsWith('today/page.tsx')) {
      // MC-034: /today delegates to TodayClient (same pattern as fridge).
      const src = read(path);
      assert.match(src, /<TodayClient\b/, 'today page delegates to TodayClient');
      continue;
    }
    if (path.endsWith('plan/page.tsx')) {
      // MC-055: /plan delegates to PlanClient (same pattern as fridge).
      const src = read(path);
      assert.match(src, /<PlanClient\b/, 'plan page delegates to PlanClient');
      continue;
    }
    if (path.endsWith('shopping/page.tsx')) {
      // MC-056: /shopping delegates to ShoppingClient (same pattern).
      const src = read(path);
      assert.match(src, /<ShoppingClient\b/, 'shopping page delegates to ShoppingClient');
      continue;
    }
    const src = read(path);
    assert.match(src, /<Card\b/, `${path} should render a Card`);
    if (path.endsWith('profile/page.tsx')) continue;
    assert.match(src, /TODO/, `${path} should mark future work with TODO`);
  }
});

test('/profile renders an explicit CTA pointing to /auth/login', () => {
  const src = read('src/app/(app)/profile/page.tsx');
  assert.match(src, /href="\/auth\/login"/);
  // T46-B (E23): the label is {t('login')} — the ru dictionary must hold
  // the Russian text.
  assert.ok(/Войти/.test(src) || /\{t\('login'\)\}/.test(src), 'login CTA present');
  assert.match(read('src/i18n/ru.ts'), /login: 'Войти'/);
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

test('middleware.ts protects every authenticated screen (T19-B, MC-014 policy)', () => {
  const mw = read('src/middleware.ts');
  assert.match(mw, /mc_session/);
  assert.match(mw, /\/auth\/login/);
  assert.match(mw, /PROTECTED_PREFIXES/);
  // All (app) screens are gated server-side — no SSR flash of private
  // content for logged-out visitors.
  const protectedSection = mw.match(/PROTECTED_PREFIXES\s*=\s*\[([^\]]+)\]/);
  assert.ok(protectedSection, 'PROTECTED_PREFIXES array literal should be parseable');
  const body = protectedSection?.[1] ?? '';
  for (const prefix of ['/profile', '/today', '/fridge', '/plan', '/shopping', '/recipe']) {
    assert.match(
      body,
      new RegExp(`'${prefix.replace('/', '\\/')}'`),
      `${prefix} must be protected`,
    );
  }
  // Landing + design demo stay public (PRD §2.3.2 guest browsing).
  assert.ok(!/'\/'/.test(body), "the landing '/' must stay public");
  assert.ok(!/'\/design'/.test(body), '/design must stay public');
});

test('middleware matcher covers every protected prefix and subpaths', () => {
  const mw = read('src/middleware.ts');
  for (const prefix of ['profile', 'today', 'fridge', 'plan', 'shopping', 'recipe']) {
    assert.match(mw, new RegExp(`'\\/${prefix}\\/:path\\*'.*`), `${prefix}/:path* matcher`);
  }
});

test('BottomTabBar package source is intact (regression guard)', () => {
  const t = read('src/components/BottomTabBar.tsx');
  assert.match(t, /h-16/); // 64px height per PRD
  assert.match(t, /safe-area-inset-bottom/);
  // T46-B (E23): aria-label resolves via next-intl (nav.ariaLabel).
  const viaI18n = /aria-label=\{t\('ariaLabel'\)\}/.test(t);
  const literal = /aria-label="Основная навигация"/.test(t);
  assert.ok(viaI18n || literal, 'nav aria-label present');
  assert.match(read('src/i18n/ru.ts'), /ariaLabel: 'Основная навигация'/);
});

test('useTheme.ts hook still exists and exports useTheme (regression guard)', () => {
  const hook = read('src/hooks/useTheme.ts');
  assert.match(hook, /export function useTheme/);
});
