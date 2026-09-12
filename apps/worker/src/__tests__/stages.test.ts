// MC-050 — stage pipeline + job mirror lifecycle tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressFor, STAGES, isStage } from '../stages.js';
import { runWithMirror, type JobMirror } from '../job-runner.js';

/* ---------------- stages ---------------- */

test('STAGES: canonical pipeline order with fixed percentages', () => {
  assert.deepEqual(
    [...STAGES],
    ['queued', 'filtering', 'scoring', 'optimizing', 'building-list', 'done'],
  );
  assert.equal(progressFor('queued'), 0);
  assert.equal(progressFor('filtering'), 20);
  assert.equal(progressFor('scoring'), 40);
  assert.equal(progressFor('optimizing'), 60);
  assert.equal(progressFor('building-list'), 80);
  assert.equal(progressFor('done'), 100);
});

test('isStage: rejects unknown stage names', () => {
  assert.equal(isStage('scoring'), true);
  assert.equal(isStage('party'), false);
});

/* ---------------- runWithMirror ---------------- */

class FakeMirror implements JobMirror {
  readonly events: Array<{ op: string; stage?: string; status?: string; value?: string }> = [];

  async setStatus(
    jobId: string,
    status: 'PROCESSING' | 'COMPLETED' | 'FAILED',
    stage: string,
  ): Promise<void> {
    this.events.push({ op: 'status', status, stage });
  }
  async setStage(jobId: string, stage: string): Promise<void> {
    this.events.push({ op: 'stage', stage });
  }
  async setResult(jobId: string, resultRef: string): Promise<void> {
    this.events.push({ op: 'result', value: resultRef });
  }
  async setError(jobId: string, error: string): Promise<void> {
    this.events.push({ op: 'error', value: error });
  }
}

test('runWithMirror: PROCESSING(filtering) → stages → COMPLETED(resultRef)', async () => {
  const mirror = new FakeMirror();
  await runWithMirror(
    { jobId: 'j1', type: 'GENERATE_PLAN' },
    async (report) => {
      await report('scoring');
      await report('done');
      return 'plan-42';
    },
    mirror,
  );
  assert.deepEqual(
    mirror.events.map((e) => [e.op, e.op === 'status' ? e.status : (e.stage ?? e.value)]),
    [
      ['status', 'PROCESSING'],
      ['stage', 'scoring'],
      ['stage', 'done'],
      ['result', 'plan-42'],
    ],
  );
});

test('runWithMirror: domain failure → FAILED with message, error rethrown', async () => {
  const mirror = new FakeMirror();
  await assert.rejects(
    runWithMirror(
      { jobId: 'j1', type: 'GENERATE_PLAN' },
      async () => {
        throw new Error('planner exploded');
      },
      mirror,
    ),
    /planner exploded/,
  );
  const last = mirror.events[mirror.events.length - 1]!;
  assert.equal(last.op, 'error');
  assert.equal(last.value, 'planner exploded');
});
