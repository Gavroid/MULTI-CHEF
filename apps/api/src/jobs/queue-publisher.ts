// MC-050 — Queue publisher (api side of the 'planning' BullMQ queue).
//
// Lazy singleton: the Redis connection is only opened on the first
// publish. When REDIS_URL is absent the publisher degrades to a no-op
// logger (dev/test without Redis) — enqueue still records the Job row,
// it just will not be processed until Redis is configured.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export interface PublishPayload {
  jobId: string;
  userId: string;
  householdId: string;
  type: string;
  params: Record<string, unknown>;
}

export interface QueuePublisher {
  publish(payload: PublishPayload): Promise<void>;
}

const QUEUE_NAME = 'planning';

// R20 F9: retry policy — a failed job is retried up to 3 times with
// exponential backoff (5s base). Exported as data so the contract is
// unit-testable without BullMQ.
export const JOB_RETRY_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 500,
} as const;

class BullmqQueuePublisher implements QueuePublisher {
  private queue: Queue | null = null;

  constructor(private readonly url: string) {}

  async publish(payload: PublishPayload): Promise<void> {
    this.queue ??= new Queue(QUEUE_NAME, {
      connection: new IORedis(this.url, { maxRetriesPerRequest: null }),
    });
    await this.queue.add(QUEUE_NAME, payload, {
      jobId: payload.jobId,
      ...JOB_RETRY_OPTS,
    });
  }
}

class NoopQueuePublisher implements QueuePublisher {
  async publish(payload: PublishPayload): Promise<void> {
    console.warn(`[jobs] REDIS_URL not configured — job ${payload.jobId} recorded but NOT queued`);
  }
}

export function createQueuePublisher(): QueuePublisher {
  const url = process.env['REDIS_URL'];
  return url ? new BullmqQueuePublisher(url) : new NoopQueuePublisher();
}
