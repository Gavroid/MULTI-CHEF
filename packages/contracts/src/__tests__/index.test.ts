import { test } from 'node:test';
import assert from 'node:assert/strict';

// MC-001 smoke: the contracts package is just a scaffold. Confirm the
// public surface compiles and is exported as expected.
test('contracts package exposes no symbols in scaffold (MC-001)', async () => {
  const mod = await import('../index.js');
  assert.deepEqual(Object.keys(mod), []);
});
