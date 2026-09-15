// MC-021 — Integration tests for the catalog endpoints.
//
// Setup is the same ad-hoc AppModule pattern from MC-011: bootstrap
// a NestFastifyApplication with `app.inject` (no real network), use a
// real Postgres (INTEGRATION_DATABASE_URL) seeded with the catalog.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { IngredientsModule } from '../../ingredients/ingredients.module.js';
import { AppHttpExceptionFilter } from '../../common/exception-filter.js';

const PKG_ROOT = process.cwd();

let app: NestFastifyApplication | undefined;
let prisma: PrismaClient | undefined;

async function setupApp(): Promise<void> {
  const url = process.env['INTEGRATION_DATABASE_URL'];
  if (!url) {
    throw new Error('INTEGRATION_DATABASE_URL is required for integration tests');
  }

  execSync(
    'pnpm --filter @multichef/database exec prisma migrate deploy --schema prisma/schema.prisma',
    {
      cwd: PKG_ROOT,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    },
  );

  // Seed the catalog if not already seeded. The seed runner is
  // idempotent so re-running is safe.
  execSync('pnpm --filter @multichef/database db:seed', {
    cwd: PKG_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  const adapter = new FastifyAdapter({ logger: false });

  @Module({
    imports: [IngredientsModule],
    providers: [{ provide: APP_FILTER, useClass: AppHttpExceptionFilter }],
  })
  class TestAppModule {}

  app = await NestFactory.create<NestFastifyApplication>(TestAppModule, adapter);
  app.setGlobalPrefix('api/v1');
  await app.init();
}

before(async () => {
  if (!process.env['RUN_DB_INTEGRATION']) return;
  await setupApp();
});

after(async () => {
  if (app) await app.close();
  if (prisma) await prisma.$disconnect();
});

beforeEach(async () => {
  if (!prisma) return;
  // Wipe the seed-derived tables so each test starts with a known
  // catalog. We KEEP IngredientCategory + Ingredient + IngredientAlias
  // rows because the catalog is seeded by the runner and tests rely
  // on them. We DO delete user-derived state in case a future test
  // creates a pantry item.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Preference","NutritionProfile","Session","User","HouseholdMember","Household","PantryItem","ShoppingListItem","ShoppingList","MealPlanEntry","MealPlanDay","MealPlan","RecipeIngredient","Recipe","PrepTask","PreparedPortion","PrepSession","Job","IngredientNutrition","StorageRule" RESTART IDENTITY CASCADE',
  );
});

function db(): PrismaClient {
  if (!prisma) throw new Error('integration setup did not initialise prisma');
  return prisma;
}

function inject(method: 'GET', url: string): Promise<{ statusCode: number; body: unknown }> {
  if (!app) throw new Error('app not initialised');
  return app.inject({ method, url }).then((res) => ({
    statusCode: res.statusCode,
    body: (() => {
      try {
        return JSON.parse(res.payload);
      } catch {
        return res.payload;
      }
    })(),
  }));
}

test('GET /ingredients (no params) → 200, data array with ≤ 50 active ingredients', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const res = await inject('GET', '/api/v1/ingredients');
  assert.equal(res.statusCode, 200);
  const body = res.body as { data: unknown[] };
  assert.ok(Array.isArray(body.data));
  assert.ok(body.data.length > 0);
  assert.ok(body.data.length <= 50);
});

test('GET /ingredients?q=помидор → contains помидор', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const res = await inject('GET', '/api/v1/ingredients?q=помидор');
  assert.equal(res.statusCode, 200);
  const body = res.body as { data: { canonicalName: string }[] };
  assert.ok(body.data.length >= 1);
  assert.ok(body.data.some((i) => i.canonicalName === 'помидор'));
});

test('GET /ingredients?q=томат → resolves via alias (pg_trgm matches IngredientAlias)', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const res = await inject('GET', '/api/v1/ingredients?q=томат');
  assert.equal(res.statusCode, 200);
  const body = res.body as { data: { canonicalName: string }[] };
  assert.ok(body.data.some((i) => i.canonicalName === 'помидор'));
});

test('GET /ingredients?category=Овощи → only VEGETABLE rows', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  // MC-003 schema has no `slug` on IngredientCategory; we filter by
  // Russian display name (the seed `category.name`). PM-prompt
  // #6 — flagging this in the MC-021 report.
  const res = await inject('GET', '/api/v1/ingredients?category=' + encodeURIComponent('Овощи'));
  assert.equal(res.statusCode, 200);
  const body = res.body as {
    data: { category: { name: string } }[];
  };
  assert.ok(body.data.length > 0);
  for (const ing of body.data) {
    assert.equal(ing.category.name, 'Овощи');
  }
});

test('GET /ingredients?sort=avgPriceKopecks&order=desc → sorted desc', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const res = await inject('GET', '/api/v1/ingredients?sort=avgPriceKopecks&order=desc');
  assert.equal(res.statusCode, 200);
  const body = res.body as { data: { avgPriceKopecks: number | null }[] };
  assert.ok(body.data.length >= 2);
  for (let i = 1; i < body.data.length; i++) {
    const prevEntry = body.data[i - 1];
    const curEntry = body.data[i];
    if (!prevEntry || !curEntry) continue;
    const prev = prevEntry.avgPriceKopecks ?? -Infinity;
    const cur = curEntry.avgPriceKopecks ?? -Infinity;
    assert.ok(prev >= cur, `expected desc, ${prev} < ${cur} at ${i}`);
  }
});

test('GET /ingredients?limit=10&offset=20 → pagination works', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const allRes = await inject('GET', '/api/v1/ingredients?limit=100');
  const all = (allRes.body as { data: { id: string }[] }).data.map((i) => i.id);
  const pageRes = await inject('GET', '/api/v1/ingredients?limit=10&offset=20');
  assert.equal(pageRes.statusCode, 200);
  const page = (pageRes.body as { data: { id: string }[] }).data;
  assert.equal(page.length, 10);
  assert.ok(page[0] && all[20]);
  if (page[0] && all[20]) {
    assert.equal(page[0].id, all[20]);
  }
});

test('GET /ingredients/:id → 200 with full ingredient + category + aliases', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const tomato = await db().ingredient.findUnique({ where: { canonicalName: 'помидор' } });
  assert.ok(tomato);
  const res = await inject('GET', '/api/v1/ingredients/' + tomato.id);
  assert.equal(res.statusCode, 200);
  const body = res.body as {
    data: {
      id: string;
      canonicalName: string;
      category: { name: string };
      aliases: { alias: string; locale: string }[];
    };
  };
  assert.equal(body.data.id, tomato.id);
  assert.equal(body.data.canonicalName, 'помидор');
  assert.ok(body.data.category);
  assert.ok(Array.isArray(body.data.aliases));
});

test('GET /ingredients/:id (unknown) → 404 INGREDIENT_NOT_FOUND', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const fakeId = '01HMZ8X9R6K7P3WXY5T2N0V4ZZ';
  const res = await inject('GET', '/api/v1/ingredients/' + fakeId);
  assert.equal(res.statusCode, 404);
  const body = res.body as { error: { code: string } };
  assert.equal(body.error.code, 'INGREDIENT_NOT_FOUND');
});

test('GET /ingredients/categories → 200, 8 categories', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const res = await inject('GET', '/api/v1/ingredients/categories');
  assert.equal(res.statusCode, 200);
  const body = res.body as { data: { id: string; name: string; sortOrder: number }[] };
  assert.equal(body.data.length, 8);
  // Sorted by sortOrder asc
  for (let i = 1; i < body.data.length; i++) {
    const prev = body.data[i - 1];
    const cur = body.data[i];
    if (!prev || !cur) continue;
    assert.ok(prev.sortOrder <= cur.sortOrder);
  }
});

test('GET /ingredients/:id/nutrition → 200 null (no nutrition seeded)', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const tomato = await db().ingredient.findUnique({ where: { canonicalName: 'помидор' } });
  assert.ok(tomato);
  const res = await inject('GET', '/api/v1/ingredients/' + tomato.id + '/nutrition');
  assert.equal(res.statusCode, 200);
  const body = res.body as { data: unknown };
  assert.equal(body.data, null);
});

test('GET /ingredients/:id/nutrition (unknown) → 404', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const fakeId = '01HMZ8X9R6K7P3WXY5T2N0V4ZZ';
  const res = await inject('GET', '/api/v1/ingredients/' + fakeId + '/nutrition');
  assert.equal(res.statusCode, 404);
  const body = res.body as { error: { code: string } };
  assert.equal(body.error.code, 'INGREDIENT_NOT_FOUND');
});

test('GET /ingredients?sort=createdAt → 400 VALIDATION_ERROR', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const res = await inject('GET', '/api/v1/ingredients?sort=createdAt');
  assert.equal(res.statusCode, 400);
  const body = res.body as { error: { code: string } };
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

test('GET /ingredients?limit=0 → 400 VALIDATION_ERROR', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const res = await inject('GET', '/api/v1/ingredients?limit=0');
  assert.equal(res.statusCode, 400);
  const body = res.body as { error: { code: string } };
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

test('GET /ingredients?limit=200 (>100) → 400 VALIDATION_ERROR', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const res = await inject('GET', '/api/v1/ingredients?limit=200');
  assert.equal(res.statusCode, 400);
  const body = res.body as { error: { code: string } };
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

test('Catalog endpoints do NOT require authentication (no mc_session cookie)', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  // No cookie sent — should still return 200, NOT 401.
  const res = await inject('GET', '/api/v1/ingredients?limit=5');
  assert.equal(res.statusCode, 200);
});
