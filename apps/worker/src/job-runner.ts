// MC-050 — job runner: mirror BullMQ job progress into the Postgres
// Job row (QUEUED → PROCESSING → COMPLETED/FAILED) stage by stage.
//
// The planner payload itself lands in MC-051; this runner owns the
// status/stage/progress lifecycle so later processors only supply the
// domain work between stages.

import { getPrisma } from '@multichef/database';
import { progressFor, type Stage } from './stages.js';

export interface JobMirror {
  setStatus(
    jobId: string,
    status: 'PROCESSING' | 'COMPLETED' | 'FAILED',
    stage: Stage,
  ): Promise<void>;
  setStage(jobId: string, stage: Stage): Promise<void>;
  setResult(jobId: string, resultRef: string): Promise<void>;
  setError(jobId: string, error: string): Promise<void>;
}

// T59-B/T26-A (audit rounds 59/26): в Job.error попадает только
// безопасная сводка — код + первые 200 символов сообщения. Стектрейсы,
// SQL и Prisma-meta не хранятся и не отдаются клиенту.
export function sanitizeJobError(err: unknown): { code: string; message: string } {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code)
      : 'INTERNAL_ERROR';
  const raw = err instanceof Error ? err.message : String(err);
  const clean = raw
    .split('\n')[0]!
    .slice(0, 200)
    .replace(/postgresql:\/\/\S+/g, '[redacted]');
  return { code, message: clean };
}

export function createPrismaJobMirror(): JobMirror {
  const prisma = getPrisma();
  const update = async (jobId: string, data: Record<string, unknown>): Promise<void> => {
    await prisma.job.update({ where: { id: jobId }, data });
  };
  return {
    setStatus: (jobId, status, stage) =>
      update(jobId, { status, stage, progress: progressFor(stage) }),
    setStage: (jobId, stage) => update(jobId, { stage, progress: progressFor(stage) }),
    setResult: (jobId, resultRef) =>
      update(jobId, { status: 'COMPLETED', stage: 'done', progress: 100, resultRef }),
    setError: (jobId, error) => update(jobId, { status: 'FAILED', error }),
  };
}

export interface RunnerPayload {
  jobId: string;
  type: string;
}

/**
 * Run the canonical lifecycle around a domain callback. The callback
 * receives a `stage` reporter so the planner (MC-051) can advance the
 * mirror while it works.
 */
export async function runWithMirror(
  payload: RunnerPayload,
  domain: (report: (stage: Stage) => Promise<void>) => Promise<string | void>,
  mirror: JobMirror = createPrismaJobMirror(),
): Promise<void> {
  const { jobId } = payload;
  try {
    await mirror.setStatus(jobId, 'PROCESSING', 'filtering');
    const report = async (stage: Stage): Promise<void> => {
      await mirror.setStage(jobId, stage);
    };
    const resultRef = await domain(report);
    if (typeof resultRef === 'string') {
      await mirror.setResult(jobId, resultRef);
    } else {
      await mirror.setStage(jobId, 'done');
    }
  } catch (err) {
    // T59-B: клиенту — только безопасная сводка (T26-A: без Prisma-meta).
    const { code, message } = sanitizeJobError(err);
    await mirror.setError(jobId, `${code}: ${message}`);
    throw err;
  }
}
