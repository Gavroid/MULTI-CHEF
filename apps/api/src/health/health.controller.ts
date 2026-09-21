import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { getPoolStats, pingDatabase } from '@multichef/database';
import { loadServerEnv } from '@multichef/config';
import { _sentryInitialized } from '../common/sentry.js';

// Health endpoints under the global /api/v1 prefix (configured in main.ts).
//
//   GET /api/v1/health/live       — process is up. Always 200.
//   GET /api/v1/health/ready      — process is up AND Postgres + Redis are reachable.
//                                   200 on success, 503 with reason otherwise.
//   GET /api/v1/health/sentry-ping  (R17-WP13) — { active, dsn } — Sentry SDK state.
//
// MC-003: readiness runs `SELECT 1` against the configured Postgres
// database (through @multichef/database.pingDatabase). If the DB is
// unreachable the readiness probe fails with a structured body so the
// reverse proxy / orchestrator can take the pod out of rotation until
// the database recovers.

interface ReadyResponse {
  status: 'ready';
  pool?: { total: number; idle: number; waiting: number } | null;
}
interface NotReadyResponse {
  status: 'not-ready';
  reason: 'db' | 'redis';
}

@Controller('health')
export class HealthController {
  @Get('live')
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async readiness(): Promise<ReadyResponse> {
    try {
      await pingDatabase();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`health/ready: postgres unreachable: ${message}`);
      const body: NotReadyResponse = { status: 'not-ready', reason: 'db' };
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
    const env = loadServerEnv();
    const redisUrl = env.REDIS_URL;
    try {
      const { default: IORedis } = await import('ioredis');
      const redis = new IORedis(redisUrl, {
        lazyConnect: true,
        connectTimeout: 2000,
        maxRetriesPerRequest: 1,
      });
      await redis.connect();
      await redis.ping();
      await redis.quit();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`health/ready: redis unreachable: ${message}`);
      const body: NotReadyResponse = { status: 'not-ready', reason: 'redis' };
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
    const pool = getPoolStats();
    return { status: 'ready', pool };
  }

  /**
   * R17-WP13 — Sentry initialisation check. Returns {active: boolean}
   * so the SRE team can `curl /health/sentry-ping` after a deploy and
   * know whether the SDK is live. Does not capture a test event.
   */
  @Get('sentry-ping')
  sentryPing(): { active: boolean; dsn: 'set' | 'unset' } {
    return {
      active: _sentryInitialized(),
      dsn: process.env['SENTRY_DSN'] ? 'set' : 'unset',
    };
  }
}

// Exported for the unit test. The status code is asserted via the
// HttpException shape above; the `HttpCode` decorator is also applied
// to the success path so /ready returns a literal 200 (Nest defaults
// to 201 for POSTs but GETs should be explicit).
export const READY_RESPONSE_TYPE: ReadyResponse = { status: 'ready' };
export const NOT_READY_RESPONSE_TYPE: NotReadyResponse = {
  status: 'not-ready',
  reason: 'db',
};
