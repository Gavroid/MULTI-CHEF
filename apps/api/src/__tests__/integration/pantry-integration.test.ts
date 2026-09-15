// MC-022 — Integration tests for the Pantry endpoints.
//
// Setup matches MC-011/MC-021: bootstrap a NestFastifyApplication
// via NestFactory + FastifyAdapter + @fastify/cookie. Two households
// are registered so we can verify cross-household 404 (NOT 403).
//
// Schema reality (MC-003, not modified in MC-022):
//   - PantryItem has no `archivedAt`. DELETE is hard delete.
//     The restore endpoint exists but always returns 400
//     ITEM_NOT_ARCHIVED (no archive state exists).
//   - `notes` and `addedAt` are NOT schema columns.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PantryModule } from '../../pantry/pantry.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { AppHttpExceptionFilter } from '../../common/exception-filter.js';
import { IdempotencyKeyGuard } from '../../common/idempotency.js';

const PKG_ROOT = process.cwd();

let app: NestFastifyApplication | undefined;
let prisma: PrismaClient | undefined;

function newEmail(): string {
  return `mc022-${randomUUID().slice(0, 12)}@example.com`;
}
function makePassword(): string {
  return 'Pa' + randomBytes(20).toString('base64url');
}

async function setupApp(): Promise<void> {
  const url = process.env['INTEGRATION_DATABASE_URL'];
  if (!url) throw new Error('INTEGRATION_DATABASE_URL is required');

  execSync(
    'pnpm --filter @multichef/database exec prisma migrate deploy --schema prisma/schema.prisma',
    {
      cwd: PKG_ROOT,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    },
  );
  execSync('pnpm --filter @multichef/database db:seed', {
    cwd: PKG_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  const adapter = new FastifyAdapter({ logger: false });
  await adapter.register(fastifyCookie as never, {
    secret: 'mc022-test-cookie-secret-not-real-just-for-signature',
  });

  @Module({
    imports: [AuthModule, PantryModule],
    providers: [
      { provide: APP_FILTER, useClass: AppHttpExceptionFilter },
      // Mount the global IdempotencyKeyGuard here too so we can
      // assert on its presence in the integration tests. The
      // production AppModule wires this via APP_GUARD; the ad-hoc
      // test setup mirrors that wiring.
      { provide: APP_GUARD, useClass: IdempotencyKeyGuard },
    ],
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
    'TRUNCATE TABLE "Preference","NutritionProfile","Session","User","HouseholdMember","Household","PantryItem","ShoppingListItem","ShoppingList","MealPlanEntry","MealPlanDay","MealPlan","RecipeIngredient","Recipe","PrepTask","PreparedPortion","PrepSession","Job","IngredientNutrition","StorageRule" RESTART IDENTITY CASCADE',
  );
});

function db(): PrismaClient {
  if (!prisma) throw new Error('integration setup did not initialise prisma');
  return prisma;
}

/**
 * ADR-0023 phase 3: PantryItem is RLS-protected — direct DB reads in
 * assertions must install the household context the same way the API
 * transaction does.
 */
function rowWithContext<T>(
  householdId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.household_id', ${householdId}, true)`;
    return fn(tx);
  });
}

interface CookieJar {
  token: string;
  householdId: string;
}

async function registerAndLogin(): Promise<CookieJar> {
  const email = newEmail();
  const password = makePassword();
  const res = await app!.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': `mc022-bootstrap-key-${email}`,
    },
    payload: JSON.stringify({ email, password }),
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.payload) as { sessionToken: string; household: { id: string } };
  return { token: body.sessionToken, householdId: body.household.id };
}

function inject(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

async function firstIngredientId(): Promise<string> {
  const ing = await db().ingredient.findFirst({ select: { id: true } });
  if (!ing) throw new Error('seed did not produce any ingredient');
  return ing.id;
}

// ──────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────

test('POST /pantry/items without auth → 400 (Idempotency-Key guard runs before AuthGuard)', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const ingId = await firstIngredientId();
  const res = await inject('POST', '/api/v1/pantry/items', {
    body: { ingredientId: ingId, quantityG: 100 },
  });
  // Global Idempotency-Key guard fires first; missing header → 400.
  // (If we send a valid Idempotency-Key, the AuthGuard fires and
  // returns 401. Both behaviours are correct under conventions.md.)
  assert.equal(res.statusCode, 400);
  const body = res.body as { error: { code: string } };
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

test('POST /pantry/items with auth + valid ingredient → 201 + envelope', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const ingId = await firstIngredientId();
  const res = await inject('POST', '/api/v1/pantry/items', {
    token: jar.token,
    idemKey: 'mc022-create-key-0001',
    body: { ingredientId: ingId, quantityG: 250.5, expiresAt: '2026-12-31' },
  });
  assert.equal(res.statusCode, 201);
  const body = res.body as {
    data: {
      id: string;
      householdId: string;
      ingredientId: string;
      quantity: number;
      unit: string;
      estimatedGrams: number;
      expiresAt: string;
      createdAt: string;
    };
  };
  assert.ok(body.data.id);
  assert.equal(body.data.householdId, jar.householdId);
  assert.equal(body.data.ingredientId, ingId);
  // Decimal columns are converted to numbers in the service view.
  assert.equal(body.data.quantity, 250.5);
  assert.equal(body.data.unit, 'G');
  assert.equal(body.data.estimatedGrams, 250.5);
});

test('POST /pantry/items with unknown ingredient → 404 INGREDIENT_NOT_FOUND', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const res = await inject('POST', '/api/v1/pantry/items', {
    token: jar.token,
    idemKey: 'mc022-create-bad-key-01',
    body: { ingredientId: '01HMZ8X9R6K7P3WXY5T2N0V4ZZ', quantityG: 100 },
  });
  assert.equal(res.statusCode, 404);
  const body = res.body as { error: { code: string } };
  assert.equal(body.error.code, 'INGREDIENT_NOT_FOUND');
});

test('POST /pantry/items without Idempotency-Key → 400', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const ingId = await firstIngredientId();
  const res = await inject('POST', '/api/v1/pantry/items', {
    token: jar.token,
    body: { ingredientId: ingId, quantityG: 100 },
  });
  assert.equal(res.statusCode, 400);
});

test('GET /pantry/items without auth → 401', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const res = await inject('GET', '/api/v1/pantry/items');
  assert.equal(res.statusCode, 401);
});

test('GET /pantry/items returns only items of current household', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jarA = await registerAndLogin();
  const jarB = await registerAndLogin();
  const ingId = await firstIngredientId();
  // A creates 2 items
  for (let i = 0; i < 2; i++) {
    const r = await inject('POST', '/api/v1/pantry/items', {
      token: jarA.token,
      idemKey: `mc022-A-key-${i}-abcxxxx`,
      body: { ingredientId: ingId, quantityG: 100 + i },
    });
    assert.equal(r.statusCode, 201);
  }
  // B creates 1 item
  const rB = await inject('POST', '/api/v1/pantry/items', {
    token: jarB.token,
    idemKey: 'mc022-B-key-0001-abcxxxx',
    body: { ingredientId: ingId, quantityG: 999 },
  });
  assert.equal(rB.statusCode, 201);

  // A only sees A's 2
  const listA = await inject('GET', '/api/v1/pantry/items', { token: jarA.token });
  assert.equal(listA.statusCode, 200);
  const bodyA = listA.body as { data: { householdId: string }[] };
  assert.equal(bodyA.data.length, 2);
  for (const item of bodyA.data) {
    assert.equal(item.householdId, jarA.householdId);
  }

  // B only sees B's 1
  const listB = await inject('GET', '/api/v1/pantry/items', { token: jarB.token });
  assert.equal(listB.statusCode, 200);
  const bodyB = listB.body as { data: { householdId: string }[] };
  assert.equal(bodyB.data.length, 1);
  assert.equal(bodyB.data[0]?.householdId, jarB.householdId);
});

test('GET /pantry/items?includeArchived=true is accepted (no-op since schema has no archivedAt)', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const ingId = await firstIngredientId();
  await inject('POST', '/api/v1/pantry/items', {
    token: jar.token,
    idemKey: 'mc022-arch-key-0001',
    body: { ingredientId: ingId, quantityG: 100 },
  });
  const res = await inject('GET', '/api/v1/pantry/items?includeArchived=true', {
    token: jar.token,
  });
  assert.equal(res.statusCode, 200);
  const body = res.body as { data: unknown[] };
  assert.ok(body.data.length >= 1);
});

test('GET /pantry/items?ingredientId=… filters', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const tomatoes = await db().ingredient.findUnique({ where: { canonicalName: 'помидор' } });
  const cucumber = await db().ingredient.findUnique({ where: { canonicalName: 'огурец' } });
  assert.ok(tomatoes && cucumber);
  await inject('POST', '/api/v1/pantry/items', {
    token: jar.token,
    idemKey: 'mc022-filter-key-0001',
    body: { ingredientId: tomatoes.id, quantityG: 100 },
  });
  await inject('POST', '/api/v1/pantry/items', {
    token: jar.token,
    idemKey: 'mc022-filter-key-0002',
    body: { ingredientId: cucumber.id, quantityG: 200 },
  });
  const res = await inject('GET', `/api/v1/pantry/items?ingredientId=${tomatoes.id}`, {
    token: jar.token,
  });
  assert.equal(res.statusCode, 200);
  const body = res.body as { data: { ingredientId: string }[] };
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0]?.ingredientId, tomatoes.id);
});

test('GET /pantry/items/:id from a different household → 404 (NOT 403)', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jarA = await registerAndLogin();
  const jarB = await registerAndLogin();
  const ingId = await firstIngredientId();
  const created = await inject('POST', '/api/v1/pantry/items', {
    token: jarA.token,
    idemKey: 'mc022-cross-key-0001',
    body: { ingredientId: ingId, quantityG: 100 },
  });
  assert.equal(created.statusCode, 201);
  const createdBody = created.body as { data: { id: string } };
  // B tries to fetch A's item
  const res = await inject('GET', `/api/v1/pantry/items/${createdBody.data.id}`, {
    token: jarB.token,
  });
  assert.equal(res.statusCode, 404);
  const body = res.body as { error: { code: string } };
  assert.equal(body.error.code, 'PANTRY_ITEM_NOT_FOUND');
});

test('PATCH /pantry/items/:id for own item → 200 + updated', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const ingId = await firstIngredientId();
  const created = await inject('POST', '/api/v1/pantry/items', {
    token: jar.token,
    idemKey: 'mc022-patch-key-0001',
    body: { ingredientId: ingId, quantityG: 100 },
  });
  const itemId = (created.body as { data: { id: string } }).data.id;
  const res = await inject('PATCH', `/api/v1/pantry/items/${itemId}`, {
    token: jar.token,
    idemKey: 'mc022-patch-key-0002',
    body: { quantityG: 500, opened: true },
  });
  assert.equal(res.statusCode, 200);
  const body = res.body as { data: { quantity: number; opened: boolean } };
  assert.equal(body.data.quantity, 500);
  assert.equal(body.data.opened, true);
});

test('PATCH /pantry/items/:id for another household → 404', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jarA = await registerAndLogin();
  const jarB = await registerAndLogin();
  const ingId = await firstIngredientId();
  const created = await inject('POST', '/api/v1/pantry/items', {
    token: jarA.token,
    idemKey: 'mc022-patch-cross-key-01',
    body: { ingredientId: ingId, quantityG: 100 },
  });
  const itemId = (created.body as { data: { id: string } }).data.id;
  const res = await inject('PATCH', `/api/v1/pantry/items/${itemId}`, {
    token: jarB.token,
    idemKey: 'mc022-patch-cross-key-02',
    body: { quantityG: 999 },
  });
  assert.equal(res.statusCode, 404);
});

test('DELETE /pantry/items/:id for own item → 204 + soft-delete (archivedAt is set)', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const ingId = await firstIngredientId();
  const created = await inject('POST', '/api/v1/pantry/items', {
    token: jar.token,
    idemKey: 'mc022-del-key-0001',
    body: { ingredientId: ingId, quantityG: 100 },
  });
  const itemId = (created.body as { data: { id: string } }).data.id;
  const res = await inject('DELETE', `/api/v1/pantry/items/${itemId}`, {
    token: jar.token,
    idemKey: 'mc022-del-key-0002',
  });
  assert.equal(res.statusCode, 204);
  // Verify the row STILL EXISTS but with archivedAt set (soft delete).
  const row = await rowWithContext(jar.householdId, (tx) =>
    tx.pantryItem.findUnique({ where: { id: itemId } }),
  );
  assert.ok(row);
  assert.ok(row.archivedAt);
  assert.ok(row.archivedAt instanceof Date);
});

test('DELETE /pantry/items/:id for another household → 404', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jarA = await registerAndLogin();
  const jarB = await registerAndLogin();
  const ingId = await firstIngredientId();
  const created = await inject('POST', '/api/v1/pantry/items', {
    token: jarA.token,
    idemKey: 'mc022-del-cross-key-01',
    body: { ingredientId: ingId, quantityG: 100 },
  });
  const itemId = (created.body as { data: { id: string } }).data.id;
  const res = await inject('DELETE', `/api/v1/pantry/items/${itemId}`, {
    token: jarB.token,
    idemKey: 'mc022-del-cross-key-02',
  });
  assert.equal(res.statusCode, 404);
});

test('Soft-delete + restore round-trip: DELETE → 204, restore → 200, archivedAt=null', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const ingId = await firstIngredientId();
  // Idempotency keys use a long random suffix to satisfy the
  // IdempotencyKeyGuard's min-length check (16+ chars), but we keep
  // the value recognisably a test placeholder so gitleaks's generic
  // api-key rule does not flag it.
  const created = await inject('POST', '/api/v1/pantry/items', {
    token: jar.token,
    idemKey: 'mc022-rt-001-zzz-test-id',
    body: { ingredientId: ingId, quantityG: 100 },
  });
  const itemId = (created.body as { data: { id: string; archivedAt: string | null } }).data.id;

  // Soft-delete
  const delRes = await inject('DELETE', `/api/v1/pantry/items/${itemId}`, {
    token: jar.token,
    idemKey: 'mc022-rt-002-zzz-test-id',
  });
  assert.equal(delRes.statusCode, 204);
  let row = await rowWithContext(jar.householdId, (tx) =>
    tx.pantryItem.findUnique({ where: { id: itemId } }),
  );
  assert.ok(row?.archivedAt);

  // Restore
  const restoreRes = await inject('POST', `/api/v1/pantry/items/${itemId}/restore`, {
    token: jar.token,
    idemKey: 'mc022-rt-003-zzz-test-id',
  });
  assert.equal(restoreRes.statusCode, 200);
  const restoreBody = restoreRes.body as { data: { id: string; archivedAt: string | null } };
  assert.equal(restoreBody.data.id, itemId);
  assert.equal(restoreBody.data.archivedAt, null);

  // DB state
  row = await rowWithContext(jar.householdId, (tx) =>
    tx.pantryItem.findUnique({ where: { id: itemId } }),
  );
  assert.equal(row?.archivedAt, null);
});

test('GET /pantry/items (default) excludes archived items', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const ingId = await firstIngredientId();
  // Create + soft-delete one
  const created = await inject('POST', '/api/v1/pantry/items', {
    token: jar.token,
    idemKey: 'mc022-listfilter-key-01',
    body: { ingredientId: ingId, quantityG: 100 },
  });
  const itemId = (created.body as { data: { id: string } }).data.id;
  await inject('DELETE', `/api/v1/pantry/items/${itemId}`, {
    token: jar.token,
    idemKey: 'mc022-listfilter-key-02',
  });
  // Create another active one
  await inject('POST', '/api/v1/pantry/items', {
    token: jar.token,
    idemKey: 'mc022-listfilter-key-03',
    body: { ingredientId: ingId, quantityG: 200 },
  });
  const listRes = await inject('GET', '/api/v1/pantry/items', {
    token: jar.token,
  });
  assert.equal(listRes.statusCode, 200);
  const listBody = listRes.body as { data: { id: string }[] };
  // Only the active one should appear.
  assert.equal(listBody.data.length, 1);
  assert.notEqual(listBody.data[0]?.id, itemId);
});

test('GET /pantry/items?includeArchived=true includes archived items', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const ingId = await firstIngredientId();
  const created = await inject('POST', '/api/v1/pantry/items', {
    token: jar.token,
    idemKey: 'mc022-incarch-key-01',
    body: { ingredientId: ingId, quantityG: 100 },
  });
  const itemId = (created.body as { data: { id: string } }).data.id;
  await inject('DELETE', `/api/v1/pantry/items/${itemId}`, {
    token: jar.token,
    idemKey: 'mc022-incarch-key-02',
  });
  const listRes = await inject('GET', '/api/v1/pantry/items?includeArchived=true', {
    token: jar.token,
  });
  assert.equal(listRes.statusCode, 200);
  const listBody = listRes.body as { data: { id: string; archivedAt: string | null }[] };
  assert.equal(listBody.data.length, 1);
  assert.equal(listBody.data[0]?.id, itemId);
  assert.ok(listBody.data[0]?.archivedAt);
});

test('POST /pantry/items with notes → stored + returned', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const ingId = await firstIngredientId();
  const res = await inject('POST', '/api/v1/pantry/items', {
    token: jar.token,
    idemKey: 'mc022-notes-key-01',
    body: {
      ingredientId: ingId,
      quantityG: 250,
      notes: 'bought at the market, organic',
    },
  });
  assert.equal(res.statusCode, 201);
  const body = res.body as { data: { notes: string | null } };
  assert.equal(body.data.notes, 'bought at the market, organic');
});

test('PATCH /pantry/items/:id can update notes', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const ingId = await firstIngredientId();
  const created = await inject('POST', '/api/v1/pantry/items', {
    token: jar.token,
    idemKey: 'mc022-patchnotes-key-01',
    body: { ingredientId: ingId, quantityG: 100, notes: 'first' },
  });
  const itemId = (created.body as { data: { id: string } }).data.id;
  const res = await inject('PATCH', `/api/v1/pantry/items/${itemId}`, {
    token: jar.token,
    idemKey: 'mc022-patchnotes-key-02',
    body: { notes: 'second' },
  });
  assert.equal(res.statusCode, 200);
  const body = res.body as { data: { notes: string | null } };
  assert.equal(body.data.notes, 'second');
});

test('PATCH on an archived item → 409 PANTRY_ITEM_ARCHIVED (T15-B), restore-first flow', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const ingId = await firstIngredientId();
  const created = await inject('POST', '/api/v1/pantry/items', {
    token: jar.token,
    idemKey: 'mc022-archivepatch-key-1',
    body: { ingredientId: ingId, quantityG: 100 },
  });
  const itemId = (created.body as { data: { id: string } }).data.id;

  const archived = await inject('DELETE', `/api/v1/pantry/items/${itemId}`, {
    token: jar.token,
    idemKey: 'mc022-archivepatch-key-2',
  });
  assert.equal(archived.statusCode, 204);

  const patched = await inject('PATCH', `/api/v1/pantry/items/${itemId}`, {
    token: jar.token,
    idemKey: 'mc022-archivepatch-key-3',
    body: { notes: 'zombie edit' },
  });
  assert.equal(patched.statusCode, 409);
  const errBody = patched.body as { error: { code: string } };
  assert.equal(errBody.error.code, 'PANTRY_ITEM_ARCHIVED');

  // Restore-first flow works again afterwards.
  const restored = await inject('POST', `/api/v1/pantry/items/${itemId}/restore`, {
    token: jar.token,
    idemKey: 'mc022-archivepatch-key-4',
  });
  assert.equal(restored.statusCode, 200);
  const repatched = await inject('PATCH', `/api/v1/pantry/items/${itemId}`, {
    token: jar.token,
    idemKey: 'mc022-archivepatch-key-5',
    body: { notes: 'after restore' },
  });
  assert.equal(repatched.statusCode, 200);
  assert.equal((repatched.body as { data: { notes: string | null } }).data.notes, 'after restore');
});

test('POST /pantry/items with notes length 501 → 400 VALIDATION_ERROR', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const ingId = await firstIngredientId();
  const res = await inject('POST', '/api/v1/pantry/items', {
    token: jar.token,
    idemKey: 'mc022-longnotes-key-01',
    body: { ingredientId: ingId, quantityG: 100, notes: 'x'.repeat(501) },
  });
  assert.equal(res.statusCode, 400);
  const body = res.body as { error: { code: string } };
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

test('POST /pantry/items/:id/restore on a not-archived item → 400 ITEM_NOT_ARCHIVED', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jar = await registerAndLogin();
  const ingId = await firstIngredientId();
  const created = await inject('POST', '/api/v1/pantry/items', {
    token: jar.token,
    idemKey: 'mc022-rest-key-0001',
    body: { ingredientId: ingId, quantityG: 100 },
  });
  const itemId = (created.body as { data: { id: string } }).data.id;
  const res = await inject('POST', `/api/v1/pantry/items/${itemId}/restore`, {
    token: jar.token,
    idemKey: 'mc022-rest-key-0002',
  });
  assert.equal(res.statusCode, 400);
  const body = res.body as { error: { code: string } };
  assert.equal(body.error.code, 'ITEM_NOT_ARCHIVED');
});

test('Cross-household restore → 404 PANTRY_ITEM_NOT_FOUND', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const jarA = await registerAndLogin();
  const jarB = await registerAndLogin();
  const ingId = await firstIngredientId();
  const created = await inject('POST', '/api/v1/pantry/items', {
    token: jarA.token,
    idemKey: 'mc022-restcross-key-01',
    body: { ingredientId: ingId, quantityG: 100 },
  });
  const itemId = (created.body as { data: { id: string } }).data.id;
  // A archives the item
  await inject('DELETE', `/api/v1/pantry/items/${itemId}`, {
    token: jarA.token,
    idemKey: 'mc022-restcross-key-02',
  });
  // B tries to restore
  const res = await inject('POST', `/api/v1/pantry/items/${itemId}/restore`, {
    token: jarB.token,
    idemKey: 'mc022-restcross-key-03',
  });
  assert.equal(res.statusCode, 404);
  const body = res.body as { error: { code: string } };
  assert.equal(body.error.code, 'PANTRY_ITEM_NOT_FOUND');
});
