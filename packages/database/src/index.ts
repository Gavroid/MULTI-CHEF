// @multichef/database — Prisma client wrapper.
//
// MC-003 source of truth for the database schema and the singleton
// PrismaClient used by apps/api and apps/worker. The client is built
// lazily on first `getPrisma()` so that importing this package is
// cheap (tests, lint, build, etc.).
//
// All consumers should pull DATABASE_URL from @multichef/config — we
// never read process.env directly here.

import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loadServerEnv } from '@multichef/config';

// Re-export the typed client + adapter so consumers can `import type`
// from a single place.
export type { PrismaClient } from '@prisma/client';
export { PrismaPg } from '@prisma/adapter-pg';

let cached: PrismaClient | undefined;

/**
 * Returns a process-wide PrismaClient. The first call validates env
 * and opens the pool; subsequent calls reuse it.
 */
export function getPrisma(): PrismaClient {
  if (cached) return cached;
  const env = loadServerEnv();
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  cached = new PrismaClient({
    adapter,
    log: env.LOG_LEVEL === 'debug' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
  return cached;
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
  const client = options?.client ?? getPrisma();
  return client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.household_id', ${ctx.householdId ?? ''}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`;
      return fn(tx);
    },
    options?.isolationLevel ? { isolationLevel: options.isolationLevel } : undefined,
  );
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
