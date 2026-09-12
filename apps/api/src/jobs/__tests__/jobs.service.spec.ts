// MC-050 — JobsService unit tests: paramsHash stability, idempotent
// enqueue (5 min dedup window), ownership-scoped reads (404, not 403).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paramsHash, JobsService, IDEMPOTENCY_WINDOW_MS } from '../jobs.service.js';
import type { PublishPayload } from '../queue-publisher.js';

/* ---------------- paramsHash ---------------- */

test('paramsHash: key order independent, undefined values ignored', () => {
  const a = paramsHash({ budgetMode: 'NORMAL', maxMinutes: 60 });
  const b = paramsHash({ maxMinutes: 60, budgetMode: 'NORMAL' });
  assert.equal(a, b);
  assert.equal(
    paramsHash({ a: 1, b: undefined }),
    paramsHash({ a: 1 }),
    'undefined values do not affect the hash',
  );
  assert.notEqual(paramsHash({ a: 1 }), paramsHash({ a: 2 }));
  assert.equal(
    paramsHash({ nested: { x: [1, { y: 2 }] } }),
    paramsHash({ nested: { x: [1, { y: 2 }] } }),
  );
});

/* ---------------- fakes ---------------- */

interface FakeJob {
  id: string;
  userId: string;
  type: string;
  paramsHash: string | null;
  status: string;
  createdAt: Date;
}

class FakePrisma {
  readonly jobs: FakeJob[] = [];
  now = Date.now();

  job = {
    findFirst: async ({ where }: { where: Record<string, unknown> }): Promise<FakeJob | null> => {
      const w = where as {
        id?: string;
        userId?: string;
        paramsHash?: string;
        createdAt?: { gte?: Date };
        status?: { in: string[] };
      };
      return (
        this.jobs.find(
          (j) =>
            (w.id === undefined || j.id === w.id) &&
            (w.userId === undefined || j.userId === w.userId) &&
            (w.paramsHash === undefined || j.paramsHash === w.paramsHash) &&
            (w.status === undefined || w.status.in.includes(j.status)) &&
            (w.createdAt === undefined || j.createdAt >= (w.createdAt.gte ?? new Date(0))),
        ) ?? null
      );
    },
    create: async ({ data }: { data: Record<string, unknown> }): Promise<FakeJob> => {
      const job: FakeJob = {
        id: data['id'] as string,
        userId: data['userId'] as string,
        type: data['type'] as string,
        paramsHash: (data['paramsHash'] as string) ?? null,
        status: data['status'] as string,
        createdAt: new Date(this.now),
      };
      this.jobs.push(job);
      return job;
    },
  };
}

class FakePublisher {
  readonly published: PublishPayload[] = [];
  async publish(payload: PublishPayload): Promise<void> {
    this.published.push(payload);
  }
}

function makeService(prisma: FakePrisma): { svc: JobsService; publisher: FakePublisher } {
  const publisher = new FakePublisher();
  const svc = new JobsService(publisher, prisma as never);
  return { svc, publisher };
}

/* ---------------- enqueue dedup ---------------- */

test('enqueue dedup: identical params within the window reuse the jobId', async () => {
  const { svc } = makeService(new FakePrisma());
  const first = await svc.enqueue('u1', 'h1', 'GENERATE_PLAN', { days: 7 });
  const second = await svc.enqueue('u1', 'h1', 'GENERATE_PLAN', { days: 7 });
  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true, 'same (user, type, hash) → dedup');
  assert.equal(first.jobId, second.jobId);
});

test('enqueue dedup: different household or params → new job', async () => {
  const { svc } = makeService(new FakePrisma());
  const first = await svc.enqueue('u1', 'h1', 'GENERATE_PLAN', { days: 7 });
  const otherParams = await svc.enqueue('u1', 'h1', 'GENERATE_PLAN', { days: 14 });
  const otherHousehold = await svc.enqueue('u1', 'h2', 'GENERATE_PLAN', { days: 7 });
  assert.equal(otherParams.deduplicated, false);
  assert.equal(otherHousehold.deduplicated, false);
  assert.notEqual(first.jobId, otherParams.jobId);
});

test('enqueue dedup: COMPLETED jobs do not dedup (window only covers open jobs)', async () => {
  const prisma = new FakePrisma();
  const { svc } = makeService(prisma);
  await svc.enqueue('u1', 'h1', 'GENERATE_PLAN', {});
  prisma.jobs[0]!.status = 'COMPLETED';
  const again = await svc.enqueue('u1', 'h1', 'GENERATE_PLAN', {});
  assert.equal(again.deduplicated, false);
});

test('enqueue: payload reaches the queue publisher', async () => {
  const { svc, publisher } = makeService(new FakePrisma());
  const res = await svc.enqueue('u1', 'h1', 'GENERATE_PLAN', { days: 7 });
  assert.equal(publisher.published.length, 1);
  assert.equal(publisher.published[0]?.jobId, res.jobId);
  assert.equal(publisher.published[0]?.householdId, 'h1');
  assert.equal(publisher.published[0]?.type, 'GENERATE_PLAN');
});

test('IDEMPOTENCY_WINDOW_MS is 5 minutes', () => {
  assert.equal(IDEMPOTENCY_WINDOW_MS, 300_000);
});

/* ---------------- getForUser ownership ---------------- */

test('getForUser: owner reads the job; foreign user gets JOB_NOT_FOUND', async () => {
  const prisma = new FakePrisma();
  const { svc } = makeService(prisma);
  const { jobId } = await svc.enqueue('u1', 'h1', 'GENERATE_PLAN', {});
  const job = await svc.getForUser(jobId, 'u1');
  assert.equal(job.id, jobId);
  await assert.rejects(
    svc.getForUser(jobId, 'u2'),
    /Job not found/,
    'foreign job must look like a missing job (privacy)',
  );
});
