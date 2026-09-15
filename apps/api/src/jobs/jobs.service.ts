// MC-050 — Jobs service: idempotent enqueue + ownership-checked reads.
//
// Postgres Job rows mirror the BullMQ queue (ADR-0004). Enqueue is
// idempotent within a 5-minute window: the same (user, type,
// paramsHash) triple with a still-open job returns the EXISTING jobId
// instead of enqueueing a duplicate. Reads are ownership-scoped:
// another user's job is a 404, never a 403 (privacy).

import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { getPrisma } from '@multichef/database';
import type { JobType } from '@multichef/contracts';
import { AppHttpException } from '../common/exception-filter.js';
import type { QueuePublisher } from './queue-publisher.js';

type PrismaLike = ReturnType<typeof getPrisma>;

/** Stable hash of the params object (key order independent). */
export function paramsHash(params: unknown): string {
  return createHash('sha256').update(stableStringify(params)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/** Deduplication window for identical enqueues (development plan MC-050). */
export const IDEMPOTENCY_WINDOW_MS = 5 * 60_000;

export interface EnqueueResult {
  jobId: string;
  /** True when an identical open job existed within the window. */
  deduplicated: boolean;
}

@Injectable()
export class JobsService {
  private readonly prismaOverride: PrismaLike | undefined;

  constructor(
    @Inject('QueuePublisher') private readonly publisher: QueuePublisher,
    /** Test seam: defaults to the process-wide Prisma client. */
    @Optional() prisma?: PrismaLike,
  ) {
    this.prismaOverride = prisma;
  }

  private get db(): PrismaLike {
    return this.prismaOverride ?? getPrisma();
  }

  async enqueue(
    userId: string,
    householdId: string,
    type: JobType,
    params: Record<string, unknown>,
  ): Promise<EnqueueResult> {
    // T70-D: kill-switch — мгновенная остановка постановки новых джоб
    // при инциденте, без деплоя.
    if (String(process.env['KILL_PLAN_GENERATION'] ?? '') === 'true' && type === 'GENERATE_PLAN') {
      throw new AppHttpException({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Генерация планов временно приостановлена',
      });
    }
    const hash = paramsHash({ householdId, ...params });
    const windowStart = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
    const existing = await this.db.job.findFirst({
      where: {
        userId,
        type,
        paramsHash: hash,
        status: { in: ['QUEUED', 'PROCESSING'] },
        createdAt: { gte: windowStart },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return { jobId: existing.id, deduplicated: true };
    }
    const jobId = randomUUID();
    await this.db.job.create({
      data: {
        id: jobId,
        userId,
        type,
        status: 'QUEUED',
        stage: 'queued',
        progress: 0,
        paramsHash: hash,
      },
    });
    await this.publisher.publish({
      jobId,
      userId,
      householdId,
      type,
      params,
    });
    return { jobId, deduplicated: false };
  }

  /** Ownership-scoped read: a foreign job is indistinguishable from a missing one. */
  async getForUser(jobId: string, userId: string) {
    const job = await this.db.job.findFirst({
      where: { id: jobId, userId },
    });
    if (!job) {
      throw new AppHttpException({
        code: 'JOB_NOT_FOUND',
        message: 'Job not found',
        details: { jobId },
      });
    }
    return job;
  }
}
