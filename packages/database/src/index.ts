// @multichef/database — Prisma client wrapper.
//
// MC-003 source of truth for the database schema and the singleton
// PrismaClient used by apps/api and apps/worker. The client is built
// lazily on first `getPrisma()` so that importing this package is
// cheap (tests, lint, build, etc.).
//
// All consumers should pull DATABASE_URL from @multichef/config — we
// never read process.env directly here.

import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loadServerEnv } from '@multichef/config';

// Re-export the typed client + adapter so consumers can `import type`
// from a single place.
export type { PrismaClient } from '@prisma/client';
export { PrismaPg } from '@prisma/adapter-pg';

let cached: PrismaClient | undefined;

/** Returns a process-wide PrismaClient. */
// T35/T68 (audit rounds 35/68): pool и таймауты настраиваются из env
// (DATABASE_POOL_MAX), runaway-транзакции рвутся, процессы различимы в
// pg_stat_activity по application_name.
export function getPrisma(): PrismaClient {
  if (cached) return cached;
  const env = loadServerEnv();
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    connectionTimeoutMillis: 5_000,
    application_name: env.DB_APPLICATION_NAME,
  });
  cached = new PrismaClient({
    adapter,
    log: env.LOG_LEVEL === 'debug' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
  return cached;
}

/** T68-D/T51-C: пул-статистика для /health/ready и мониторинга. */
export function getPoolStats(): { total: number; idle: number; waiting: number } | null {
  const adapter = (
    cached as
      | { adapter?: { pool?: { totalCount?: number; idleCount?: number; waitingCount?: number } } }
      | undefined
  )?.adapter;
  const pool = adapter?.pool;
  if (!pool) return null;
  return {
    total: pool.totalCount ?? 0,
    idle: pool.idleCount ?? 0,
    waiting: pool.waitingCount ?? 0,
  };
}

// ADR-0023 phase 2 — tenant context for Row-Level Security.
//
// mc087/mc088 install the tenant_isolation policies and enable RLS on
// "PantryItem". Every query against an RLS-enabled table must run with
// the session variables app.user_id / app.household_id set, otherwise
// it fails closed (sees nothing). `withTenantContext` opens an
// interactive transaction, installs the context with
// `set_config(..., true)` (transaction-local — pool-safe by design)
// and runs the callback on the transaction client.
//
// Tables without RLS enabled are unaffected: the transaction is
// transparent for them.

export interface TenantContext {
  householdId?: string;
  userId?: string;
}

export interface WithTenantContextOptions {
  /** e.g. 'Serializable' for flows that need strict isolation (T20-A). */
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

export async function withTenantContext<T>(
  ctx: TenantContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: WithTenantContextOptions & {
    /** DI- seam для unit-тестов: клиент вместо getPrisma(). */
    client?: PrismaClient;
  },
): Promise<T> {
  const client = (options?.client ?? getPrisma()) as PrismaClient;
  // R18-WP29: R18-WP29 — Prisma 6's interactive $transaction creates
  // savepoints internally, and `set_config(..., true)` (local-to-tx)
  // set before the first statement is not visible to the savepoint
  // running the actual INSERT (verified: INSERT returned affected=1
  // but no row was persisted; the RLS WITH CHECK clause sees a NULL
  // current_setting() and rejects the insert; the savepoint then
  // rolls back the INSERT while the wrapper returns the generated
  // id from Prisma's in-memory cache).
  //
  // Workaround: set the config at SESSION level (third arg = false)
  // BEFORE opening the transaction. Prisma's interactive transaction
  // pins the same physical connection from its pool for the lifetime
  // of the callback, so a session-level setting stays in effect.
  // After COMMIT/ROLLBACK we reset both vars to '' so they do not
  // leak to the next unrelated query on the same pooled connection.
  if (ctx.householdId || ctx.userId) {
    await client.$executeRawUnsafe(
      `SELECT set_config('app.household_id', ${
        ctx.householdId ? `'${ctx.householdId.replace(/'/g, "''")}'` : "''"
      }, false), set_config('app.user_id', ${
        ctx.userId ? `'${ctx.userId.replace(/'/g, "''")}'` : "''"
      }, false)`,
    );
  }
  try {
    return await client.$transaction(async (tx) => fn(tx), {
      maxWait: 5_000,
      timeout: 15_000,
      ...(options?.isolationLevel ? { isolationLevel: options.isolationLevel } : {}),
    });
  } finally {
    // Best-effort reset so the same pooled connection does not leak
    // the tenant context to the next unrelated query.
    await client
      .$executeRawUnsafe(
        "SELECT set_config('app.household_id', '', false), set_config('app.user_id', '', false)",
      )
      .catch(() => undefined);
  }
}

/**
 * Closes the cached client. Safe to call when no client has been
 * created. Used by health checks and shutdown hooks.
 */
export async function closePrisma(): Promise<void> {
  if (!cached) return;
  await cached.$disconnect();
  cached = undefined;
}

/**
 * Cheap liveness probe — `SELECT 1`. Throws on connection failure so
 * callers (health endpoints) can surface a 503.
 */
export async function pingDatabase(): Promise<void> {
  const client = getPrisma();
  await client.$queryRaw`SELECT 1`;
}
