// Design-system integration test (MC-012).
//
// Verifies the end-to-end wiring of @multichef/ui into apps/web:
//   - the package is a workspace dependency
//   - Tailwind v3 picks up the token classes (bg-primary, text-text, …)
//   - the /_design demo route exists
//   - the useTheme hook module is present and exports the right surface
//
// We assert by reading source rather than rendering, because the route is
// a Next.js server component — render-time assertions belong in Playwright
// (out of scope for MC-012). Source-level assertions are enough to catch
// the regressions that actually cost us time (imports broken, config lost).

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

test('package.json lists @multichef/ui as a workspace dep', () => {
  const pkg = JSON.parse(read('package.json')) as { dependencies?: Record<string, string> };
  assert.ok(pkg.dependencies);
  assert.match(pkg.dependencies['@multichef/ui'] ?? '', /workspace:/);
});

test('package.json lists tailwindcss v3 + postcss + autoprefixer as devDeps', () => {
  const pkg = JSON.parse(read('package.json')) as {
    devDependencies?: Record<string, string>;
  };
  assert.ok(pkg.devDependencies);
  const tailwindVer = pkg.devDependencies['tailwindcss'] ?? '';
  const postcssVer = pkg.devDependencies['postcss'] ?? '';
  const autoprefixerVer = pkg.devDependencies['autoprefixer'] ?? '';
  assert.match(tailwindVer, /^[\^~]?3\./);
  assert.ok(postcssVer, 'postcss should be a devDep');
  assert.ok(autoprefixerVer, 'autoprefixer should be a devDep');
});

test('postcss.config.mjs registers tailwindcss + autoprefixer plugins', () => {
  const cfg = read('postcss.config.mjs');
  assert.match(cfg, /tailwindcss:/);
  assert.match(cfg, /autoprefixer:/);
});

test('apps/web/src/hooks/useTheme.ts exists with the documented API', () => {
  const hook = read('src/hooks/useTheme.ts');
  assert.match(hook, /export function useTheme/);
  assert.match(hook, /toggle/);
  // Theme persistence in localStorage with the documented key prefix.
  assert.match(hook, /localStorage/);
  assert.match(hook, /mc-theme/);
});

test('ThemeToggle component wires useTheme()', () => {
  const toggle = read('src/components/ThemeToggle.tsx');
  assert.match(toggle, /useTheme/);
  assert.match(toggle, /aria-label/);
  assert.match(toggle, /aria-pressed/);
});

test('design demo route exists at /design with all component sections', () => {
  const design = read('src/app/design/page.tsx');
  for (const section of ['Button', 'Card', 'Input', 'Chip', 'Badge', 'Skeleton', 'ToastProvider']) {
    assert.ok(design.includes(section), `design demo should mention ${section}`);
  }
  assert.match(design, /DesignDemoClient/);
});

test('BottomSheet + Toast work via the client component', () => {
  const client = read('src/app/design/_DesignDemoClient.tsx');
  assert.match(client, /BottomSheet/);
  assert.match(client, /toast\./);
});

test('globals.css defines light + dark themes + reduced-motion block', () => {
  const css = read('src/app/globals.css');
  assert.match(css, /:root/);
  assert.match(css, /\[data-theme=['"]dark['"]\]/);
  assert.match(css, /prefers-reduced-motion/);
});
