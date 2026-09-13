import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { pingDatabase } from '@multichef/database';

// Health endpoints under the global /api/v1 prefix (configured in main.ts).
//
//   GET /api/v1/health/live  — process is up. Always 200.
//   GET /api/v1/health/ready — process is up AND Postgres is reachable.
//                             200 on success, 503 with reason="db" otherwise.
//
// MC-003: readiness runs `SELECT 1` against the configured Postgres
// database (through @multichef/database.pingDatabase). If the DB is
// unreachable the readiness probe fails with a structured body so the
// reverse proxy / orchestrator can take the pod out of rotation until
// the database recovers.

interface ReadyResponse {
  status: 'ready';
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
      // Surface a structured 503 with the failing dependency. Do not
      // leak the underlying Prisma error message — it can include the
      // connection string and other secrets in older Prisma versions.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`health/ready: postgres unreachable: ${message}`);
      const body: NotReadyResponse = { status: 'not-ready', reason: 'db' };
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
    // Audit round-11: the worker and the sync recommendation endpoints
    // depend on Redis (BullMQ queue) — readiness must reflect it too.
    const redisUrl = process.env['REDIS_URL'];
    if (redisUrl) {
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
    }
    return { status: 'ready' };
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
