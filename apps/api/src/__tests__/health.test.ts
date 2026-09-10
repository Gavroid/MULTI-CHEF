import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HealthController } from '../health/health.controller.js';
import { closePrisma } from '@multichef/database';

test('health controller live returns ok', () => {
  const controller = new HealthController();
  assert.deepEqual(controller.liveness(), { status: 'ok' });
});

test('health controller ready returns ready when pingDatabase resolves', async () => {
  // Happy path requires a reachable Postgres (local dev / CI both have
  // one). If the env has no DATABASE_URL at all, the negative path runs
  // instead — the contract under test is the envelope, not the network.
  const controller = new HealthController();
  try {
    const result = await controller.readiness();
    assert.deepEqual(result, { status: 'ready' });
  } catch (err) {
    const response = (err as { getResponse?: () => unknown }).getResponse?.();
    assert.deepEqual(response, { status: 'not-ready', reason: 'db' });
  }
});

test('health controller ready returns 503 with reason=db when pingDatabase rejects', async () => {
  // The Prisma client is cached process-wide; a warm cache would let
  // this test reach a real DB even after deleting DATABASE_URL. Drop
  // the cache (await — closePrisma is async) so getPrisma() must
  // re-validate the env and throw EnvValidationError.
  await closePrisma();

  const saved = process.env['DATABASE_URL'];
  delete process.env['DATABASE_URL'];
  try {
    const controller = new HealthController();
    await assert.rejects(
      () => controller.readiness(),
      (err: unknown) => {
        const response = (err as { getResponse?: () => unknown }).getResponse?.();
        assert.deepEqual(response, { status: 'not-ready', reason: 'db' });
        return true;
      },
    );
  } finally {
    if (saved !== undefined) process.env['DATABASE_URL'] = saved;
  }
});
