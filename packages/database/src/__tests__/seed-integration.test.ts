// MC-020 — Integration tests for the seed runner.
//
// Run with `RUN_DB_INTEGRATION=1 INTEGRATION_DATABASE_URL=... pnpm test:integration`.
// These tests reset the database to a known state, then run the seed
// runner twice to verify idempotency.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CATEGORIES } from '../seed/categories.js';
import { INGREDIENTS } from '../seed/ingredients.js';

const PKG_ROOT = process.cwd();

let prisma: PrismaClient | undefined;

async function setupDb(): Promise<void> {
  const url = process.env['INTEGRATION_DATABASE_URL'];
  if (!url) {
    throw new Error('INTEGRATION_DATABASE_URL is required for integration tests');
  }
  execSync(
    'pnpm exec prisma migrate deploy --schema ../../packages/database/prisma/schema.prisma',
    {
      cwd: PKG_ROOT,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    },
  );
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

async function resetDb(): Promise<void> {
  if (!prisma) return;
  // Wipe everything in dependency order.
  await prisma.preference.deleteMany();
  await prisma.ingredientAlias.deleteMany();
  await prisma.ingredientNutrition.deleteMany();
  await prisma.ingredient.deleteMany();
  await prisma.ingredientCategory.deleteMany();
  await prisma.householdMember.deleteMany();
  await prisma.household.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
}

async function runSeed(): Promise<void> {
  // Run the seed via the package script (uses loadServerEnv + Prisma).
  // Tests set DATABASE_URL via the wrapper script.
  execSync('pnpm db:seed', {
    cwd: PKG_ROOT,
    env: process.env,
    stdio: 'pipe',
  });
}

before(async () => {
  if (!process.env['RUN_DB_INTEGRATION']) return;
  await setupDb();
  await resetDb();
});

after(async () => {
  if (prisma) await prisma.$disconnect();
});

function db(): PrismaClient {
  if (!prisma) throw new Error('integration setup did not initialise prisma');
  return prisma;
}

test('seed: creates exactly 8 categories', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  await runSeed();
  const cats = await db().ingredientCategory.findMany();
  assert.equal(cats.length, CATEGORIES.length);
  assert.equal(cats.length, 8);
});

test('seed: creates exactly 300 ingredients', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  await runSeed();
  const ings = await db().ingredient.findMany();
  assert.equal(ings.length, 300);
  assert.equal(ings.length, INGREDIENTS.length);
});

test('seed: ingredient counts per category match INGREDIENTS', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  await runSeed();
  const ings = await db().ingredient.findMany({
    select: { categoryId: true },
  });
  const cats = await db().ingredientCategory.findMany();
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const counts = new Map<string, number>();
  for (const ing of ings) {
    const name = catName.get(ing.categoryId);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  // 8 categories must each have ≥1 ingredient.
  assert.equal(counts.size, 8);
  for (const c of CATEGORIES) {
    assert.ok((counts.get(c.name) ?? 0) > 0, `${c.name} has no ingredients`);
  }
});

test('seed: at least 100 aliases are created', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  await runSeed();
  const aliases = await db().ingredientAlias.count();
  assert.ok(aliases >= 100, `expected ≥100 aliases, got ${aliases}`);
});

test('seed: ingredient fields are populated correctly', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  await runSeed();
  const spot = await db().ingredient.findUnique({
    where: { canonicalName: 'помидор' },
  });
  assert.ok(spot);
  assert.equal(spot.avgPriceKopecks, 8000);
  assert.equal(spot.packageSize, 500);
  assert.equal(spot.defaultUnit, 'G');
  assert.equal(spot.status, 'ACTIVE');
  assert.ok(spot.density !== null && spot.density > 0);
  assert.ok(spot.ediblePartRatio > 0 && spot.ediblePartRatio <= 1);
});

test('seed: is idempotent — second run produces the same row counts', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  await runSeed();
  const counts1 = {
    cats: await db().ingredientCategory.count(),
    ings: await db().ingredient.count(),
    aliases: await db().ingredientAlias.count(),
  };
  // Run the seed a second time.
  await runSeed();
  const counts2 = {
    cats: await db().ingredientCategory.count(),
    ings: await db().ingredient.count(),
    aliases: await db().ingredientAlias.count(),
  };
  assert.deepEqual(counts2, counts1);
});

test('seed: updates existing ingredient fields on second run', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  await runSeed();
  // Manually change a value.
  await db().ingredient.update({
    where: { canonicalName: 'помидор' },
    data: { avgPriceKopecks: 12345 },
  });
  // Run seed again — should restore the catalog value (8000).
  await runSeed();
  const restored = await db().ingredient.findUnique({
    where: { canonicalName: 'помидор' },
  });
  assert.equal(restored?.avgPriceKopecks, 8000);
});

test('seed: aliases deduplicate on second run', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  await runSeed();
  const before = await db().ingredientAlias.count();
  await runSeed();
  const after = await db().ingredientAlias.count();
  assert.equal(after, before);
});
