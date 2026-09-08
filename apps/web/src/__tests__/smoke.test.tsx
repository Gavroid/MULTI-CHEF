import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = await readFile(resolve(here, '../app/page.tsx'), 'utf8');
const layoutSource = await readFile(resolve(here, '../app/layout.tsx'), 'utf8');

test('home page renders MULTI-CHEF scaffold heading (MC-001)', () => {
  assert.match(pageSource, /MULTI-CHEF/);
  assert.match(pageSource, /scaffold/);
});

test('layout declares mobile-first viewport (MC-001)', () => {
  assert.match(layoutSource, /viewport/);
  assert.match(layoutSource, /device-width/);
});
