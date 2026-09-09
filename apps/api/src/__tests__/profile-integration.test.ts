// MC-011 — Profile integration tests. Run with
// RUN_DB_INTEGRATION=1 INTEGRATION_DATABASE_URL=... pnpm test:integration.
//
// We bootstrap a small ad-hoc AppModule (Profile + Household + Auth)
// directly with the Fastify driver so the full Nest DI container is
// wired the same way as production main.ts. The test starts a
// NestFastifyApplication per suite, then exercises the full HTTP
// stack with `app.inject(...)` — no real network.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ProfileModule } from '../profile/profile.module.js';
import { HouseholdModule } from '../household/household.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AppHttpExceptionFilter } from '../common/exception-filter.js';

const PKG_ROOT = process.cwd();

let app: NestFastifyApplication | undefined;
let prisma: PrismaClient | undefined;

function newEmail(): string {
  return `mc011-${randomUUID().slice(0, 12)}@example.com`;
}

function makePassword(): string {
  return 'Pa' + randomBytes(20).toString('base64url');
}

async function setupApp(): Promise<void> {
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

  const adapter = new FastifyAdapter({ logger: false });
  // Register @fastify/cookie so `req.cookies` parses the
  // `cookie: mc_session=…` header we pass via `app.inject`.
  await adapter.register(fastifyCookie as never, {
    secret: 'test-cookie-secret-not-a-real-secret-just-for-signature',
  });

  @Module({
    imports: [AuthModule, ProfileModule, HouseholdModule],
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
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Preference","NutritionProfile","Session","User","HouseholdMember","Household","Ingredient","IngredientCategory" RESTART IDENTITY CASCADE',
  );
});

function db(): PrismaClient {
  if (!prisma) throw new Error('integration setup did not initialise prisma');
  return prisma;
}

interface CookieJar {
  token: string;
}

async function registerAndLogin(): Promise<CookieJar> {
  // Hit /api/v1/auth/register via app.inject to get a real session
  // token. We use a fresh email + password per call so each test
  // gets its own user/household.
  const res = await app!.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'mc011-bootstrap' },
    payload: JSON.stringify({ email: newEmail(), password: makePassword() }),
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.payload) as { sessionToken: string };
  return { token: body.sessionToken };
}

function inject(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  opts: { token?: string; idemKey?: string; body?: unknown } = {},
): Promise<{ statusCode: number; body: unknown }> {
  if (!app) throw new Error('app not initialised');
  const headers: Record<string, string> = {};
  if (opts.token) headers['cookie'] = `mc_session=${opts.token}`;
  if (opts.idemKey) headers['idempotency-key'] = opts.idemKey;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return app
    .inject({
      method,
      url,
      headers,
      ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
    })
    .then((res) => ({
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

test('GET /profile returns user + household + (empty) preferences', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const res = await inject('GET', '/api/v1/profile', { token: jar.token });
  assert.equal(res.statusCode, 200);
  const body = res.body as {
    user: { email: string };
    household: { ownerId: string; defaultPeopleCount: number };
    nutritionProfile: unknown;
    preferences: unknown[];
  };
  assert.ok(body.user.email);
  assert.equal(body.household.defaultPeopleCount, 2);
  assert.equal(body.nutritionProfile, null);
  assert.deepEqual(body.preferences, []);
});

test('GET /profile without cookie → 401 UNAUTHORIZED', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const res = await inject('GET', '/api/v1/profile');
  assert.equal(res.statusCode, 401);
  const body = res.body as { error: { code: string } };
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('PATCH /profile updates locale', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const res = await inject('PATCH', '/api/v1/profile', {
    token: jar.token,
    idemKey: 'mc011-patch-1',
    body: { locale: 'en' },
  });
  assert.equal(res.statusCode, 200);
  const body = res.body as { locale: string };
  assert.equal(body.locale, 'en');
});

test('PATCH /profile with conflicting email → 409 CONFLICT', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const emailA = newEmail();
  // Register A via HTTP, then register B via HTTP.
  await inject('POST', '/api/v1/auth/register', {
    idemKey: 'mc011-A1',
    body: { email: emailA, password: makePassword() },
  });
  const jarB = await registerAndLogin();
  // Try to make B's email equal to A's — must fail.
  const res = await inject('PATCH', '/api/v1/profile', {
    token: jarB.token,
    idemKey: 'mc011-conflict-1',
    body: { email: emailA },
  });
  assert.equal(res.statusCode, 409);
});

test('PUT /profile/nutrition upserts (create + update)', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const res1 = await inject('PUT', '/api/v1/profile/nutrition', {
    token: jar.token,
    idemKey: 'mc011-nutr-1',
    body: { targetCalories: 2200, mealsPerDay: 4, skillLevel: 'BEGINNER' },
  });
  assert.equal(res1.statusCode, 200);
  const np1 = res1.body as {
    targetCalories: number;
    mealsPerDay: number;
    skillLevel: string;
  };
  assert.equal(np1.targetCalories, 2200);
  assert.equal(np1.mealsPerDay, 4);
  assert.equal(np1.skillLevel, 'BEGINNER');

  // Update existing
  const res2 = await inject('PUT', '/api/v1/profile/nutrition', {
    token: jar.token,
    idemKey: 'mc011-nutr-2',
    body: { targetCalories: 1800, skillLevel: 'CONFIDENT' },
  });
  assert.equal(res2.statusCode, 200);
  const np2 = res2.body as {
    targetCalories: number;
    mealsPerDay: number;
    skillLevel: string;
  };
  assert.equal(np2.targetCalories, 1800);
  assert.equal(np2.mealsPerDay, 4); // unchanged
  assert.equal(np2.skillLevel, 'CONFIDENT');
});

test('GET /profile/nutrition returns null until upserted', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const res = await inject('GET', '/api/v1/profile/nutrition', { token: jar.token });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, null);
});

test('POST /profile/preferences creates a Preference; GET returns it', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const res = await inject('POST', '/api/v1/profile/preferences', {
    token: jar.token,
    idemKey: 'mc011-pref-1',
    body: { kind: 'ALLERGY', note: 'no shellfish' },
  });
  assert.equal(res.statusCode, 201);
  const pref = res.body as { id: string; kind: string; note: string };
  assert.equal(pref.kind, 'ALLERGY');
  assert.equal(pref.note, 'no shellfish');

  const list = await inject('GET', '/api/v1/profile/preferences', { token: jar.token });
  assert.equal(list.statusCode, 200);
  const items = list.body as Array<{ id: string; kind: string }>;
  assert.equal(items.length, 1);
  assert.equal(items[0]!.id, pref.id);
});

test('DELETE /profile/preferences/:id removes the row', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const created = await inject('POST', '/api/v1/profile/preferences', {
    token: jar.token,
    idemKey: 'mc011-pref-2',
    body: { kind: 'LOVE', note: 'loves tomatoes' },
  });
  const pref = created.body as { id: string };
  const del = await inject('DELETE', `/api/v1/profile/preferences/${pref.id}`, {
    token: jar.token,
    idemKey: 'mc011-pref-3',
  });
  assert.equal(del.statusCode, 204);
  const list = await inject('GET', '/api/v1/profile/preferences', { token: jar.token });
  assert.equal((list.body as unknown[]).length, 0);
});

test('DELETE /profile/preferences/:id by another user → 404', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jarA = await registerAndLogin();
  const jarB = await registerAndLogin();
  const created = await inject('POST', '/api/v1/profile/preferences', {
    token: jarA.token,
    idemKey: 'mc011-pref-A1',
    body: { kind: 'LOVE', note: 'mine' },
  });
  const pref = created.body as { id: string };
  const del = await inject('DELETE', `/api/v1/profile/preferences/${pref.id}`, {
    token: jarB.token,
    idemKey: 'mc011-pref-B1',
  });
  assert.equal(del.statusCode, 404);
});

test('POST /profile/onboarding creates NutritionProfile + Preferences', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  // Seed an IngredientCategory + Ingredient so onboarding can reference
  // a ULID. Unique names per run so the test is idempotent against
  // a non-truncated test database.
  const suffix = randomUUID().slice(0, 8);
  const categoryId = `01CATEGOR${suffix.toUpperCase()}AAAAAAAAA`;
  await db().ingredientCategory.create({
    data: { id: categoryId, name: `Vegetables-${suffix}`, sortOrder: 1 },
  });
  const ingId = `01INGRED${suffix.toUpperCase()}AAAAAAAAAA`;
  await db().ingredient.create({
    data: {
      id: ingId,
      canonicalName: `Test Tomato ${suffix}`,
      categoryId,
      defaultUnit: 'G',
      status: 'ACTIVE',
    },
  });

  const jar = await registerAndLogin();
  const res = await inject('POST', '/api/v1/profile/onboarding', {
    token: jar.token,
    idemKey: 'mc011-onboard-1',
    body: {
      householdSize: 3,
      budgetPerWeekKopecks: 12_500_00,
      allergies: [ingId],
      likedIngredients: [],
      dislikedIngredients: [],
      appliances: ['STOVE', 'OVEN'],
      skillLevel: 'CONFIDENT',
      typicalCookTimeMin: 30,
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.body as {
    nutritionProfile: { mealsPerDay: number; preferredPrepMinutes: number };
    preferencesCreated: number;
  };
  assert.equal(body.preferencesCreated, 1);
  assert.equal(body.nutritionProfile.preferredPrepMinutes, 30);

  const list = await inject('GET', '/api/v1/profile/preferences?kind=ALLERGY', {
    token: jar.token,
  });
  assert.equal(list.statusCode, 200);
  const items = list.body as Array<{ kind: string; ingredientId: string | null }>;
  assert.equal(items.length, 1);
  assert.equal(items[0]!.ingredientId, ingId);

  // Re-run onboarding with same body — preferencesCreated should be 0
  // (idempotent).
  const res2 = await inject('POST', '/api/v1/profile/onboarding', {
    token: jar.token,
    idemKey: 'mc011-onboard-2',
    body: {
      householdSize: 3,
      budgetPerWeekKopecks: 12_500_00,
      allergies: [ingId],
      likedIngredients: [],
      dislikedIngredients: [],
      appliances: ['STOVE', 'OVEN'],
      skillLevel: 'CONFIDENT',
      typicalCookTimeMin: 30,
    },
  });
  assert.equal(res2.statusCode, 200);
  const body2 = res2.body as { preferencesCreated: number };
  assert.equal(body2.preferencesCreated, 0);
});

test('GET /household returns the current household', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const res = await inject('GET', '/api/v1/household', { token: jar.token });
  assert.equal(res.statusCode, 200);
  const body = res.body as { name: string; ownerId: string };
  assert.ok(body.ownerId);
  assert.equal(body.name, 'Моя семья');
});

test('PATCH /household updates the name', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const res = await inject('PATCH', '/api/v1/household', {
    token: jar.token,
    idemKey: 'mc011-house-1',
    body: { name: 'The Smiths' },
  });
  assert.equal(res.statusCode, 200);
  const body = res.body as { name: string };
  assert.equal(body.name, 'The Smiths');
});
