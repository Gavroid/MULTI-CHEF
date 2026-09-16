import type { OnModuleDestroy } from '@nestjs/common';
// MC-042 — Roulette reject counter (server is the source of truth).
//
// PRD §2.3.5: the user may reject at most 2 cards per session; the
// session lives 30 minutes (TTL refreshed on each reject). The counter
// is backed by Redis when REDIS_URL is configured; otherwise a
// process-local in-memory fallback keeps dev/test environments working
// (single-instance limitation documented in the decision log — prod
// runs Redis per PRD §6).

export const ROULETTE_TTL_SECONDS = 30 * 60;

export interface RouletteCounter {
  /** Increment the counter, set TTL when new, return the new count. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  /** Current count (0 when the key does not exist). */
  get(key: string): Promise<number>;
}

export class InMemoryRouletteCounter implements RouletteCounter {
  private readonly counts = new Map<string, { value: number; expiresAt: number }>();

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const now = Date.now();
    const entry = this.counts.get(key);
    if (!entry || entry.expiresAt <= now) {
      this.counts.set(key, { value: 1, expiresAt: now + ttlSeconds * 1000 });
      return 1;
    }
    entry.value += 1;
    return entry.value;
  }

  async get(key: string): Promise<number> {
    const entry = this.counts.get(key);
    if (!entry || entry.expiresAt <= Date.now()) return 0;
    return entry.value;
  }
}

/** Minimal surface of ioredis we rely on (kept injectable for tests). */
export interface RedisLike {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
  disconnect(): void;
}

export class RedisRouletteCounter implements RouletteCounter, OnModuleDestroy {
  constructor(private readonly redis: RedisLike) {}

  // E26: the open ioredis socket kept the process alive after
  // app.close() — integration harnesses (mc033) hung on teardown.
  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const value = await this.redis.incr(key);
    if (value === 1) {
      await this.redis.expire(key, ttlSeconds);
    }
    return value;
  }

  async get(key: string): Promise<number> {
    const raw = await this.redis.get(key);
    return raw === null ? 0 : Number.parseInt(raw, 10) || 0;
  }
}
