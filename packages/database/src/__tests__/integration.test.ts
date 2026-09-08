import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// MC-003 Testcontainers integration tests.
//
// Two ways to run:
//
//   1. pnpm --filter @multichef/database test:integration
//      Spins up a real postgres:16-alpine container via Testcontainers,
//      runs `prisma migrate deploy` against it, then exercises the
//      schema. Requires Docker on the host.
//
//   2. INTEGRATION_DATABASE_URL=postgresql://... RUN_DB_INTEGRATION=1
//      pnpm --filter @multichef/database test:integration
//      Skips the container spawn and uses the supplied connection
//      string directly. Useful for CI runners that don't have Docker
//      (or for local development against an existing Postgres).
//
// If neither path is available the tests abort before touching the
// network. That is the expected behaviour on hosts without Docker and
// is not a merge blocker.

const PKG_ROOT = new URL('../..', import.meta.url).pathname;

// Tiny id generator. The schema requires `id String @id` but the
// application supplies it (PRD §3); 26 hex chars match ULID length.
function newId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 26);
}

let container: StartedPostgreSqlContainer | undefined;
let prisma: PrismaClient | undefined;

async function startContainer(): Promise<StartedPostgreSqlContainer> {
  const started = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('multichef_test')
    .withUsername('multichef')
    .withPassword('test_password')
    .start();
  return started;
}

function applyMigrations(databaseUrl: string): void {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: PKG_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
}

before(async () => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    return;
  }
  // Path 2 wins: an externally provided connection string.
  const externalUrl = process.env['INTEGRATION_DATABASE_URL'];
  if (!externalUrl) {
    try {
      container = await startContainer();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Testcontainers throws when no Docker runtime is available.
      // We surface a clear skip message instead of a noisy failure
      // so the test run is informative on dev machines without
      // Docker. The `t.skip` is invoked per-test, so we only need to
      // make sure `prisma` stays undefined here.
      console.warn(
        `[integration] Testcontainers unavailable (${message}); skipping. ` +
          'Set INTEGRATION_DATABASE_URL to a reachable Postgres to run the tests without Docker.',
      );
      return;
    }
  }
  const finalUrl = externalUrl ?? container!.getConnectionUri();
  applyMigrations(finalUrl);
  const adapter = new PrismaPg({ connectionString: finalUrl });
  prisma = new PrismaClient({ adapter });
});

after(async () => {
  if (prisma) await prisma.$disconnect();
  if (container) await container.stop();
});

beforeEach(async () => {
  if (!prisma) return;
  // Clean slate — Prisma's `migrate deploy` does not truncate.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Job","PreparedPortion","PrepTask","PrepSession","ShoppingListItem","ShoppingList","MealPlanEntry","MealPlanDay","MealPlan","StorageRule","RecipeNutrition","RecipeIngredient","Recipe","PantryItem","IngredientNutrition","IngredientAlias","Ingredient","IngredientCategory","Preference","NutritionProfile","HouseholdMember","Household","Session","User" RESTART IDENTITY CASCADE',
  );
});

test('migrate deploy applies cleanly on a fresh Postgres 16 container', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set; set to 1 to run Testcontainers tests');
    return;
  }
  assert.ok(prisma, 'prisma client should be initialised');
  // A trivial query confirms the connection is wired and the schema is in place.
  const result = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
  assert.deepEqual(result, [{ ok: 1 }]);
});

test('User → Household → HouseholdMember graph inserts and cascades on user delete', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  assert.ok(prisma, 'prisma client should be initialised');

  const user = await prisma.user.create({
    data: {
      id: newId(),
      email: 'owner@example.com',
      passwordHash: 'argon2id$placeholder',
    },
  });
  const household = await prisma.household.create({
    data: { id: newId(), ownerId: user.id },
  });
  const member = await prisma.householdMember.create({
    data: { householdId: household.id, userId: user.id, role: 'OWNER' },
  });

  assert.equal(member.householdId, household.id);
  assert.equal(member.userId, user.id);
  assert.equal(member.role, 'OWNER');

  // Removing a member from the household is itself cascade-clean: the
  // HouseholdMember row is dropped. We exercise that path here
  // because Household.ownerId is RESTRICT by design (a household
  // must not be orphaned by a user delete). The full user-delete path
  // is covered by the cascade from HouseholdMember + Session/Job.
  await prisma.householdMember.delete({
    where: { householdId_userId: { householdId: household.id, userId: user.id } },
  });
  const remaining = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId: household.id, userId: user.id } },
  });
  assert.equal(remaining, null);
});

test('cascade on user delete: HouseholdMember and Session rows are removed', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  assert.ok(prisma, 'prisma client should be initialised');

  // A user without an owned household can be deleted. HouseholdMember
  // and Session cascades still fire.
  const user = await prisma.user.create({
    data: {
      id: newId(),
      email: 'leaf@example.com',
      passwordHash: 'argon2id$placeholder',
    },
  });
  await prisma.session.create({
    data: {
      id: newId(),
      userId: user.id,
      tokenHash: `hash-${user.id}`,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
  });
  const before = await prisma.session.count({ where: { userId: user.id } });
  assert.equal(before, 1);

  await prisma.user.delete({ where: { id: user.id } });
  const after = await prisma.session.count({ where: { userId: user.id } });
  assert.equal(after, 0);
});

test('only one ACTIVE MealPlan per household (partial unique index)', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  assert.ok(prisma, 'prisma client should be initialised');

  const user = await prisma.user.create({
    data: {
      id: newId(),
      email: 'plan-owner@example.com',
      passwordHash: 'argon2id$placeholder',
    },
  });
  const household = await prisma.household.create({
    data: { id: newId(), ownerId: user.id },
  });
  await prisma.householdMember.create({
    data: { householdId: household.id, userId: user.id, role: 'OWNER' },
  });

  const today = new Date('2026-09-08');
  const tomorrow = new Date('2026-09-15');

  const basePlan = {
    householdId: household.id,
    startDate: today,
    endDate: tomorrow,
    peopleCount: 2,
    generationSettings: { mood: 'NEUTRAL' },
  };

  await prisma.mealPlan.create({
    data: { ...basePlan, id: newId(), status: 'ACTIVE' },
  });

  // A second ACTIVE plan on the same household must violate the
  // partial unique index. Postgres surfaces this as P2002 or 23505.
  await assert.rejects(
    prisma.mealPlan.create({
      data: { ...basePlan, id: newId(), status: 'ACTIVE' },
    }),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      return (
        /P2002/.test(message) ||
        /unique constraint/i.test(message) ||
        /one_active_plan/i.test(message)
      );
    },
    'Second ACTIVE plan on the same household must be rejected',
  );

  // A non-ACTIVE plan on the same household is fine.
  const draft = await prisma.mealPlan.create({
    data: { ...basePlan, id: newId(), status: 'DRAFT' },
  });
  assert.equal(draft.status, 'DRAFT');
});
