// MC-050 — worker entry: BullMQ Worker on the 'planning' queue.
//
// Graceful shutdown: SIGTERM/SIGINT stop accepting new jobs and wait
// for the active job before exiting (development plan DoD: kill -TERM
// during a job must not lose it — BullMQ requeues stalled jobs).

import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { processJob, type ProcessPayload } from './processor.js';

const QUEUE_NAME = 'planning';

export function createConnection(): InstanceType<typeof IORedis> {
  const url = process.env['REDIS_URL'];
  if (!url) {
    throw new Error('worker: REDIS_URL is required to consume the planning queue');
  }
  return new IORedis(url, { maxRetriesPerRequest: null });
}

export async function startWorker(): Promise<Worker<ProcessPayload>> {
  return new Worker<ProcessPayload>(QUEUE_NAME, processJob, {
    connection: createConnection(),
    concurrency: 2,
  });
}

async function main(): Promise<void> {
  const worker = await startWorker();
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`worker: received ${signal}, draining…`);
    await worker.close();
    console.log('worker: bye');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  console.log('worker: planning queue consumer ready');
}

void main();
