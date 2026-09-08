import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// When the test is run from source (`src/__tests__/`) the target is at
// `src/app/page.tsx`. When it is run from a built `dist/__tests__/`
// location, the target is at `../src/app/page.tsx`. Walk up from `here`
// until we find the file.
function findProjectRoot(start: string): string {
  let cursor = start;
  for (let i = 0; i < 8; i += 1) {
    const candidate = resolve(cursor, 'src/app/page.tsx');
    try {
      readFileSync(candidate, 'utf8');
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

test('home page renders MULTI-CHEF scaffold heading (MC-001)', () => {
  assert.match(pageSource, /MULTI-CHEF/);
  assert.match(pageSource, /scaffold/);
});

test('layout declares mobile-first viewport (MC-001)', () => {
  assert.match(layoutSource, /viewport/);
  assert.match(layoutSource, /device-width/);
});
