import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// Walk up from this file's directory until we find `apps/web/src/`. The
// `node --test --import tsx` invocation can land in either the source
// tree or a built `dist/` copy, so we discover the project root
// dynamically.
function findProjectRoot(start: string): string {
  let cursor = start;
  for (let i = 0; i < 8; i += 1) {
    try {
      readFileSync(resolve(cursor, 'src/app/page.tsx'), 'utf8');
      return cursor;
    } catch {
      const parent = resolve(cursor, '..');
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  return start;
}

const root = findProjectRoot(here);
const pageSource = readFileSync(resolve(root, 'src/app/page.tsx'), 'utf8');
const layoutSource = readFileSync(resolve(root, 'src/app/layout.tsx'), 'utf8');
const globalsCss = readFileSync(resolve(root, 'src/app/globals.css'), 'utf8');
const tailwindConfig = readFileSync(resolve(root, 'tailwind.config.ts'), 'utf8');

test('landing page renders MULTI-CHEF heading (MC-012)', () => {
  assert.match(pageSource, /MULTI-CHEF/);
  // Renders Button + Card from @multichef/ui — proves the design system
  // primitives are wired into the landing.
  assert.match(pageSource, /@multichef\/ui/);
  assert.match(pageSource, /<Button\b/);
  assert.match(pageSource, /<Card\b/);
});

test('landing page uses the theme toggle (light/dark)', () => {
  assert.match(pageSource, /ThemeToggle/);
});

test('layout declares mobile-first viewport + lang=ru (MC-012)', () => {
  assert.match(layoutSource, /viewport/);
  assert.match(layoutSource, /device-width/);
  assert.match(layoutSource, /lang="ru"/);
});

test('layout applies data-theme="light" baseline (MC-012)', () => {
  assert.match(layoutSource, /data-theme="light"/);
});

test('globals.css declares PRD §2.5 color tokens', () => {
  for (const token of [
    '--color-bg',
    '--color-surface',
    '--color-primary',
    '--color-fresh',
    '--color-warning',
    '--color-danger',
    '--color-info',
  ]) {
    assert.match(globalsCss, new RegExp(`${token}:`), `globals.css should define ${token}`);
  }
});

test('globals.css provides a [data-theme="dark"] override block', () => {
  assert.match(globalsCss, /\[data-theme=['"]dark['"]\]/);
});

test('tailwind.config.ts maps the color tokens into the theme', () => {
  // Every CSS variable listed in tailwind.config.ts should resolve to
  // the `var(--color-…)` form so light/dark swaps work.
  for (const token of ['primary', 'bg', 'surface', 'fresh', 'danger']) {
    assert.match(
      tailwindConfig,
      new RegExp(`${token}:\\s*['"]var\\(--color-${token}\\)['"]`),
      `tailwind theme.colors.${token} should reference var(--color-${token})`,
    );
  }
});

test('tailwind.config.ts configures mobile-first content scan', () => {
  assert.match(tailwindConfig, /content:/);
  assert.match(tailwindConfig, /apps\/web\/src/);
  assert.match(tailwindConfig, /packages\/ui\/src/);
});
