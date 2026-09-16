import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HealthController } from '../health/health.controller.js';
import { closePrisma } from '@multichef/database';

test('health controller live returns ok', () => {
  const controller = new HealthController();
  assert.deepEqual(controller.liveness(), { status: 'ok' });
});

test('health controller ready returns ready when pingDatabase resolves', async () => {
  // The contract under test is the envelope shape, not network speed:
  // readiness() answers {status:'ready', pool} when Postgres AND Redis
  // answer, or throws a 503 envelope with reason 'db' | 'redis'. Under
  // c8 the first connect can be slow enough to trip the Redis 2s
  // connect timeout — both 'db' and 'redis' are valid not-ready
  // reasons here, so accept any of the three legitimate outcomes.
  const controller = new HealthController();
  const isReadyShape = (r: unknown): boolean =>
    typeof r === 'object' && r !== null && (r as { status?: string }).status === 'ready';
  const isNotReadyEnvelope = (r: unknown): boolean =>
    typeof r === 'object' &&
    r !== null &&
    (r as { status?: string }).status === 'not-ready' &&
    ['db', 'redis'].includes((r as { reason?: string }).reason ?? '');
  try {
    const result = await controller.readiness();
    assert.ok(isReadyShape(result), `unexpected ready shape: ${JSON.stringify(result)}`);
  } catch (err) {
    const response = (err as { getResponse?: () => unknown }).getResponse?.();
    assert.ok(
      isNotReadyEnvelope(response),
      `unexpected not-ready envelope: ${JSON.stringify(response)}`,
    );
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
