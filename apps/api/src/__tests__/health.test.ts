import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HealthController } from '../health/health.controller';

test('health controller returns ok on liveness (MC-001)', () => {
  const controller = new HealthController();
  assert.deepEqual(controller.liveness(), { status: 'ok' });
});

test('health controller returns ok on readiness (MC-001)', () => {
  const controller = new HealthController();
  assert.deepEqual(controller.readiness(), { status: 'ok' });
});
