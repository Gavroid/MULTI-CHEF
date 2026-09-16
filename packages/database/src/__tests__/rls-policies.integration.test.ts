// ADR-0023 phase 1 — SQL-level proof of the tenant-isolation policies.
//
// The mc087 migration creates the RLS policies INERT (no ENABLE), so
// this test flips RLS on for the pilot table ("NutritionProfile",
// user-scoped), sets the app.user_id context the way the Phase 2 data
// layer will (set_config(..., true) inside a transaction), and
// verifies:
//   * context A sees its own row,
//   * context B sees nothing,
//   * no context sees nothing (fail-closed),
//   * WITH CHECK rejects inserting a row for another user.
// Finally RLS is disabled again, restoring the inert deployment state.
//
// Run modes mirror integration.test.ts (Testcontainers container or
// INTEGRATION_DATABASE_URL); requires RUN_DB_INTEGRATION=1.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const PKG_ROOT = new URL('../..', import.meta.url).pathname;

let container: StartedPostgreSqlContainer | undefined;
let prisma: PrismaClient | undefined;
let rlsPrisma: PrismaClient | undefined;
let databaseUrl: string | undefined;
let rlsUrl: string | undefined;

async function setupApp(): Promise<void> {
  const externalUrl = process.env['INTEGRATION_DATABASE_URL'];
  if (!externalUrl) {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('multichef_test')
      .withUsername('multichef')
      .withPassword('test_password')
      .start();
    databaseUrl = container.getConnectionUri();
  } else {
    databaseUrl = externalUrl;
  }
  execSync('pnpm exec prisma migrate deploy', {
    cwd: PKG_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  // CI/bootstrap users are SUPERUSER, which silently BYPASSESSES every
  // RLS policy and would defeat these assertions. Create (idempotently)
  // a plain LOGIN role and a dedicated client through it — the RLS
  // checks below run with exactly the privileges the app will have.
  execSync(
    `pnpm exec psql "${databaseUrl}" -v ON_ERROR_STOP=1 << 'SQL'
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mc_rls_probe') THEN
          CREATE ROLE mc_rls_probe LOGIN PASSWORD 'rls_probe_password' NOSUPERUSER NOBYPASSRLS;
        END IF;
      END $$;
      GRANT USAGE ON SCHEMA public TO mc_rls_probe;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO mc_rls_probe;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO mc_rls_probe;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO mc_rls_probe;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO mc_rls_probe;
SQL`,
    { cwd: PKG_ROOT, stdio: 'pipe' },
  );
  rlsUrl = databaseUrl.replace(/\/\/([^:@/]+):([^@/]*)@/, '//mc_rls_probe:rls_probe_password@');
  rlsPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: rlsUrl }) });
}

before(async () => {
  if (!process.env['RUN_DB_INTEGRATION']) return;
  try {
    await setupApp();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[rls-policies] setup unavailable (${message}); skipping.`);
  }
});

after(async () => {
  if (rlsPrisma) await rlsPrisma.$disconnect().catch(() => undefined);
  // Restore the inert deployment state whatever the test outcome.
  try {
    await prisma?.$executeRawUnsafe(
      'ALTER TABLE "NutritionProfile" DISABLE ROW LEVEL SECURITY; ALTER TABLE "NutritionProfile" NO FORCE ROW LEVEL SECURITY',
    );
    await prisma?.$executeRawUnsafe('DELETE FROM "User" WHERE email LIKE \'rls-%@test.local\'');
  } catch {
    /* already off / nothing to clean */
  }
  await prisma?.$disconnect();
});

test('NutritionProfile RLS: own context sees the row, other/no context sees nothing, WITH CHECK rejects', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION'] || !prisma) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const db = prisma;
  // rlsPrisma = same database through the non-BYPASSRLS role.
  const rdb = rlsPrisma as PrismaClient;
  const userA = 'RLSUSERA000000000000000001';
  const userB = 'RLSUSERB000000000000000002';

  // Self-heal: a previous run that crashed mid-test may have left
  // RLS enabled — reset to the inert state before seeding.
  await db.$executeRawUnsafe(
    'ALTER TABLE "NutritionProfile" DISABLE ROW LEVEL SECURITY; ALTER TABLE "NutritionProfile" NO FORCE ROW LEVEL SECURITY',
  );

  // Idempotency: drop leftovers from a previous run (User cascade also
  // removes NutritionProfile rows).
  await db.$executeRawUnsafe(`DELETE FROM "User" WHERE email LIKE 'rls-%@test.local'`);

  await db.$executeRawUnsafe(
    `INSERT INTO "User" (id, email, "passwordHash", "createdAt", "updatedAt") VALUES
       ('${userA}', 'rls-a@test.local', 'x', now(), now()),
       ('${userB}', 'rls-b@test.local', 'x', now(), now())`,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "NutritionProfile" ("userId", "mealsPerDay") VALUES ('${userA}', 3)`,
  );

  // Activate the policies under test (Phase 3 behaviour, scoped to the pilot table).
  await db.$executeRawUnsafe('ALTER TABLE "NutritionProfile" ENABLE ROW LEVEL SECURITY');
  await db.$executeRawUnsafe('ALTER TABLE "NutritionProfile" FORCE ROW LEVEL SECURITY');

  const countAs = async (userId: string): Promise<number> =>
    rdb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      const rows = (await tx.$queryRaw`SELECT "userId" FROM "NutritionProfile"`) as Array<{
        userId: string;
      }>;
      return rows.length;
    });

  assert.equal(await countAs(userA), 1, 'context A must see its own profile');
  assert.equal(await countAs(userB), 0, 'context B must see nothing of user A');

  const noContext = (await rdb.$queryRaw`SELECT "userId" FROM "NutritionProfile"`) as Array<{
    userId: string;
  }>;
  assert.equal(noContext.length, 0, 'fail-closed: no context → no rows');

  // WITH CHECK: writing a profile for user B under context A is rejected.
  await assert.rejects(
    rdb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userA}, true)`;
      await tx.$executeRawUnsafe(`INSERT INTO "NutritionProfile" ("userId") VALUES ('${userB}')`);
    }),
    /row-level security/i,
  );

  // Legitimate write under the owner's own context succeeds.
  await rdb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${userB}, true)`;
    await tx.$executeRawUnsafe(`INSERT INTO "NutritionProfile" ("userId") VALUES ('${userB}')`);
  });
  assert.equal(await countAs(userB), 1);
});
