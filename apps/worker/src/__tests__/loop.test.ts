import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IdleLoop } from '../loop';

test('idle loop starts stopped', () => {
  const loop = new IdleLoop();
  assert.equal(loop.isRunning(), false);
});

test('idle loop can be toggled running', () => {
  const loop = new IdleLoop();
  loop.setRunning(true);
  assert.equal(loop.isRunning(), true);
  loop.setRunning(false);
  assert.equal(loop.isRunning(), false);
});

test('idle loop tick is a no-op (MC-001)', async () => {
  const loop = new IdleLoop();
  await loop.tick();
  // Still no throw, still no state change.
  assert.equal(loop.isRunning(), false);
});

test('idle loop stop is idempotent', async () => {
  const loop = new IdleLoop();
  loop.setRunning(true);
  await loop.stop();
  assert.equal(loop.isRunning(), false);
});
