// R20 F9: the publisher must attach a retry policy (3 attempts,
// exponential backoff 5s base) to every enqueued job — before this a
// failed job was never re-attempted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOB_RETRY_OPTS } from '../jobs/queue-publisher.js';

test('JOB_RETRY_OPTS: 3 attempts, exponential backoff from 5s, bounded history', () => {
  assert.equal(JOB_RETRY_OPTS.attempts, 3);
  assert.equal(JOB_RETRY_OPTS.backoff.type, 'exponential');
  assert.equal(JOB_RETRY_OPTS.backoff.delay, 5000);
  assert.equal(JOB_RETRY_OPTS.removeOnComplete, 500);
});
