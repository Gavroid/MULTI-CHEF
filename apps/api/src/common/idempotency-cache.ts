// T15-A / T20-B (audit rounds 15 + 20) — Idempotency replay cache.
//
// docs/api/conventions.md §3 promises that replaying a mutation with
// the same Idempotency-Key and the same body returns the cached
// response instead of re-executing. Until now the guard in
// idempotency.ts only validated the header's presence, so a retried
// POST /auth/register came back as 409 CONFLICT and clients could
// never rely on the header across a flaky connection.
//
// Semantics implemented here (per conventions.md §3):
//   * same key + same fingerprint (method|url|body) → cached response
//   * same key + different fingerprint              → 409 IDEMPOTENT_REPLAY
//   * TTL: 24 hours
//   * only successful (non-throwing) handler results are cached; a
//     failed request re-executes on retry.
//
// Cookies: auth handlers set mc_session/mc_csrf via reply.setCookie
// while the first request executes. The interceptor records those
// calls and re-applies them on replay, so a retried register/login
// still ends up with a working session.
//
// Fail-open: when Redis is unreachable (or REDIS_URL is unset in
// dev/tests) every request simply executes — the header remains
// validated by IdempotencyKeyGuard, only the caching is lost. A
// single warning is logged per process so the degradation is visible.

import { Injectable, Logger } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import IORedis from 'ioredis';
import { of, throwError } from 'rxjs';
import type { Observable } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { createHash } from 'node:crypto';
import { loadServerEnv } from '@multichef/config';
import { AppHttpException } from './exception-filter.js';
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_MIN_LENGTH } from './idempotency.js';

/** conventions.md §3: "TTL ключа — 24 часа". */
export const IDEMPOTENCY_TTL_SECONDS = 86_400;

const CACHE_PREFIX = 'idem:';
const SKIP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** How long a caller waits for an in-flight duplicate before failing open. */
const INFLIGHT_WAIT_MS = 8_000;
/** In-flight lock lifetime — outlives slow handlers, dies on its own. */
const IDEMPOTENCY_LOCK_TTL_SECONDS = 60;

export interface IdempotencyStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /**
   * In-flight lock (6.3): true when THIS caller acquired it. Atomic on
   * the underlying store so concurrent callers serialise.
   */
  tryLock(key: string, ttlSeconds: number): Promise<boolean>;
  unlock(key: string): Promise<void>;
}

interface SetCookieCall {
  name: string;
  value: string;
  options?: Record<string, unknown> | undefined;
}

interface CachedEntry {
  fingerprint: string;
  /** `undefined` (JSON.stringify drops it) when the handler resolved void — e.g. a 204 route. */
  body?: unknown;
  cookies?: SetCookieCall[];
}

export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(private readonly client: IORedis) {}

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async tryLock(key: string, ttlSeconds: number): Promise<boolean> {
    const ok = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return ok === 'OK';
  }

  async unlock(key: string): Promise<void> {
    await this.client.del(key);
  }
}

/** Single-process fallback for tests / Redis-less dev runs. */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  /** Public for tests — lets them assert that nothing was cached. */
  readonly entries = new Map<string, { value: string; expiresAt: number }>();
  private readonly lockExpiry = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return hit.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async tryLock(key: string, ttlSeconds: number): Promise<boolean> {
    const expiresAt = this.lockExpiry.get(key);
    if (expiresAt !== undefined && expiresAt > Date.now()) return false;
    this.lockExpiry.set(key, Date.now() + ttlSeconds * 1000);
    return true;
  }

  async unlock(key: string): Promise<void> {
    this.lockExpiry.delete(key);
  }
}

let cachedStore: Promise<IdempotencyStore | null> | undefined;

/**
 * Lazily build the process-wide store: dial Redis once and cache the
 * outcome. Returns null when Redis is not configured or unreachable —
 * callers then skip caching entirely (fail-open).
 */
export function getIdempotencyStore(): Promise<IdempotencyStore | null> {
  cachedStore ??= connectIdempotencyStore();
  return cachedStore;
}

async function connectIdempotencyStore(): Promise<IdempotencyStore | null> {
  let url: string;
  try {
    url = loadServerEnv().REDIS_URL;
  } catch {
    return null; // env not validated (unit tests) — cacheless mode
  }
  // lazyConnect + explicit connect(): without it ioredis rejects every
  // command issued while the socket is still opening (enableOfflineQueue
  // is off so requests can never queue behind a dead connection).
  const client = new IORedis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 3_000,
    retryStrategy: (times) => (times > 2 ? null : 200),
  });
  client.on('error', () => {
    /* swallowed — get/set callers fail open */
  });
  try {
    await client.connect();
    return new RedisIdempotencyStore(client);
  } catch {
    client.disconnect();
    return null;
  }
}

type HttpReply = FastifyReply & {
  setCookie: (name: string, value: string, options?: Record<string, unknown>) => FastifyReply;
};

function fingerprintOf(method: string, url: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method}|${url}|${JSON.stringify(body ?? null)}`)
    .digest('hex');
}

@Injectable()
export class IdempotencyReplayInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyReplayInterceptor.name);
  private readonly injected: IdempotencyStore | null | undefined;
  private defaultStore: IdempotencyStore | null | undefined;
  private warnedUnavailable = false;

  /** `store` is injection/test seam — omit it to use the Redis default. */
  constructor(store?: IdempotencyStore | null) {
    this.injected = store;
  }

  private async getStore(): Promise<IdempotencyStore | null> {
    if (this.injected !== undefined) return this.injected;
    this.defaultStore ??= await getIdempotencyStore();
    return this.defaultStore;
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const store = await this.getStore();
    if (!store) return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<{
      method?: string;
      url?: string;
      headers: Record<string, unknown>;
      body?: unknown;
    }>();
    const reply = http.getResponse<HttpReply>();

    const method = (req.method ?? 'GET').toUpperCase();
    if (SKIP_METHODS.has(method)) return next.handle();
    const key = req.headers[IDEMPOTENCY_HEADER];
    if (typeof key !== 'string' || key.length < IDEMPOTENCY_MIN_LENGTH) return next.handle();

    const fingerprint = fingerprintOf(method, req.url ?? '', req.body);
    const cacheKey = `${CACHE_PREFIX}${key}`;
    const lockKey = `${CACHE_PREFIX}lock:${key}`;

    // T20-B/6.3: bounded wait behind an in-flight executor before
    // giving up and executing anyway (fail-open).
    let polls = 0;
    for (;;) {
      let raw: string | null | 'unavailable' = null;
      try {
        raw = await store.get(cacheKey);
      } catch {
        raw = 'unavailable';
      }
      if (raw === 'unavailable') {
        this.warnUnavailable(new Error('cache read failed'));
        if (++polls >= 2) return next.handle();
        await this.sleep(150);
        continue;
      }
      if (raw !== null) {
        let cached: CachedEntry;
        try {
          cached = JSON.parse(raw) as CachedEntry;
        } catch {
          return next.handle(); // corrupt entry — execute for real
        }
        if (cached.fingerprint !== fingerprint) {
          throw new AppHttpException({
            code: 'IDEMPOTENT_REPLAY',
            message: 'Idempotency-Key was already used with a different request',
            details: { 'Idempotency-Key': key },
          });
        }
        for (const call of cached.cookies ?? []) {
          reply.setCookie(call.name, call.value, call.options);
        }
        return of(cached.body);
      }

      const owner = await this.safeTryLock(store, lockKey);
      if (owner) break; // we own execution
      if (Date.now() >= this.deadlineFor(polls)) return next.handle(); // fail-open
      await this.sleep(100);
      polls += 1;
    }

    // Record setCookie side effects so the replay can restore them.
    const cookieCalls: SetCookieCall[] = [];
    const originalSetCookie = reply.setCookie.bind(reply);
    reply.setCookie = (name, value, options) => {
      cookieCalls.push({ name, value, options });
      return originalSetCookie(name, value, options);
    };

    return next.handle().pipe(
      mergeMap(async (body) => {
        reply.setCookie = originalSetCookie;
        const entry = JSON.stringify({ fingerprint, body, cookies: cookieCalls });
        try {
          await store.set(cacheKey, entry, IDEMPOTENCY_TTL_SECONDS);
        } catch (err) {
          this.warnUnavailable(err);
        }
        // Release the in-flight lock: the cached response now serves replays.
        try {
          await store.unlock(lockKey);
        } catch {
          /* lock TTL cleans up */
        }
        return body;
      }),
      catchError((err: unknown) => {
        // Handler failed without caching — release the lock so a retry
        // can execute instead of waiting out the lock TTL.
        void store
          .unlock(lockKey)
          .catch(() => {
            /* fail-open */
          })
          .catch(() => undefined);
        return throwError(() => err);
      }),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private deadlineFor(polls: number): number {
    void polls;
    return Date.now() + INFLIGHT_WAIT_MS;
  }

  private async safeTryLock(store: IdempotencyStore, lockKey: string): Promise<boolean> {
    try {
      return await store.tryLock(lockKey, IDEMPOTENCY_LOCK_TTL_SECONDS);
    } catch {
      return false;
    }
  }

  private warnUnavailable(err: unknown): void {
    if (this.warnedUnavailable) return;
    this.warnedUnavailable = true;
    this.logger.warn(
      `idempotency cache unavailable — replay dedup disabled (fail-open): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
