// MC-050 — worker entry: BullMQ Worker on the 'planning' queue.
//
// Graceful shutdown: SIGTERM/SIGINT stop accepting new jobs and wait
// for the active job before exiting (development plan DoD: kill -TERM
// during a job must not lose it — BullMQ requeues stalled jobs).
//
// T21/T53 (audits 21/53): attempts+backoff, lockDuration/stalled
// tuning, removeOn* policy. T51-A: HTTP healthcheck :3002 (k8s).
// T21-C: structured JSON logger с jobId.

import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { createServer } from 'node:http';
import { loadServerEnv } from '@multichef/config';
import { processJob, type ProcessPayload } from './processor.js';
import { createLogger } from './logger.js';

const QUEUE_NAME = 'planning';
const log = createLogger('worker');

export function createConnection(): InstanceType<typeof IORedis> {
  // T55-A: валидация env на старте (fail-fast), как в API.
  const url = loadServerEnv().REDIS_URL;
  return new IORedis(url, { maxRetriesPerRequest: null });
}

export async function startWorker(): Promise<Worker<ProcessPayload>> {
  const worker = new Worker<ProcessPayload>(QUEUE_NAME, processJob, {
    connection: createConnection(),
    concurrency: 2,
    // T53-A: длинные plan-джобы (до минуты+) не должны считаться
    // stalled при дефолтных 30s.
    lockDuration: 120_000,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  });
  // T21-C: структурные логи жизненного цикла джобы.
  worker.on('active', (job) => log.info({ jobId: job.id }, 'job active'));
  worker.on('completed', (job) => log.info({ jobId: job.id }, 'job completed'));
  worker.on('failed', (job, err) => log.error({ jobId: job?.id, err: err.message }, 'job failed'));
  worker.on('stalled', (jobId: string) => log.warn({ jobId }, 'job stalled'));
  return worker;
}

async function main(): Promise<void> {
  const worker = await startWorker();

  // T51-A: health endpoint для k8s/container-проб — процесс жив и
  // рабочий цикл запущен.
  const health = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', queue: QUEUE_NAME }));
  });
  health.listen(3002, '127.0.0.1');
  log.info({ port: 3002 }, 'worker health listening');

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'draining…');
    await worker.close();
    health.close();
    log.info('worker: bye');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  log.info('worker: planning queue consumer ready');
}

void main();
