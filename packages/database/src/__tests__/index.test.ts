import { test } from 'node:test';
import assert from 'node:assert/strict';

test('database package exposes no symbols in scaffold (MC-001)', async () => {
  const mod = await import('../index.js');
  assert.deepEqual(Object.keys(mod), []);
});
