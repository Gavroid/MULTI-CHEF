// MC-010 integration tests for the auth module.
//
// Run with: `RUN_DB_INTEGRATION=1 INTEGRATION_DATABASE_URL=... pnpm test:integration`
//
// These tests skip themselves when RUN_DB_INTEGRATION is not set; they
// require a real Postgres (Testcontainers if Docker is available, or
// the externally-provided INTEGRATION_DATABASE_URL).

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { AuthModule, AuthService } from '../../auth/auth.module.js';
import { hashSessionToken } from '../../auth/session-token.js';

// The test runner is invoked from apps/api (e.g.
// `pnpm --filter @multichef/api test:integration`), so we resolve
// relative to that directory.
const PKG_ROOT = process.cwd();

let prisma: PrismaClient | undefined;
let app: NestFastifyApplication | undefined;
let service: AuthService | undefined;

function newEmail(): string {
  return `mc010-${randomUUID().slice(0, 12)}@example.com`;
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
    'pnpm --filter @multichef/database exec prisma migrate deploy --schema prisma/schema.prisma',
    {
      cwd: PKG_ROOT,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    },
  );

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  app = await NestFactory.create<NestFastifyApplication>(
    AuthModule,
    new FastifyAdapter({ logger: false }),
  );
  await app.init();
  service = app.get(AuthService);
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
    'TRUNCATE TABLE "Session","User","HouseholdMember","Household" RESTART IDENTITY CASCADE',
  );
});

// Helpers used inside the tests — they assume the suite was set up
// by the `before()` hook. When RUN_DB_INTEGRATION is unset the test
// cases skip themselves before reaching these.

function db(): PrismaClient {
  if (!prisma) throw new Error('integration setup did not initialise prisma');
  return prisma;
}

function svc(): AuthService {
  if (!service) throw new Error('integration setup did not initialise service');
  return service;
}

test('register: creates user + session + household + member', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const email = newEmail();
  const password = makePassword();

  const result = await svc().register({ email, password });

  assert.equal(result.user.email, email);
  assert.match(result.user.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(result.sessionToken.length >= 32);

  const households = await db().household.findMany({ where: { ownerId: result.user.id } });
  assert.equal(households.length, 1);

  const members = await db().householdMember.findMany({ where: { userId: result.user.id } });
  assert.equal(members.length, 1);
  assert.equal(members[0]!.role, 'OWNER');

  const sessions = await db().session.findMany({ where: { userId: result.user.id } });
  assert.equal(sessions.length, 1);
  // SHA-256 hex (PRD §3.2) — deterministic, no argon2id prefix.
  assert.equal(sessions[0]!.tokenHash, hashSessionToken(result.sessionToken));
  assert.match(sessions[0]!.tokenHash, /^[0-9a-f]{64}$/);
});

test('register: duplicate email throws CONFLICT', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const email = newEmail();
  const password = makePassword();
  await svc().register({ email, password });

  await assert.rejects(
    () => svc().register({ email, password }),
    (err: unknown) => (err as { code?: string }).code === 'CONFLICT',
  );
});

test('login: correct password returns user + session token', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const email = newEmail();
  const password = makePassword();
  await svc().register({ email, password });

  const result = await svc().login({ email, password });
  assert.equal(result.user.email, email);
  assert.ok(result.sessionToken.length >= 32);

  const sessions = await db().session.findMany({ where: { userId: result.user.id } });
  assert.equal(sessions.length, 2);
});

test('login: wrong password throws UNAUTHORIZED', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const email = newEmail();
  const password = makePassword();
  await svc().register({ email, password });

  await assert.rejects(
    () => svc().login({ email, password: 'definitely-wrong-password' }),
    (err: unknown) => (err as { code?: string }).code === 'UNAUTHORIZED',
  );

  const sessions = await db().session.findMany({ where: { revokedAt: null } });
  assert.equal(sessions.length, 1);
});

test('login: unknown email takes the same time as wrong password (timing-safe)', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const t0 = process.hrtime.bigint();
  await assert.rejects(() => svc().login({ email: 'nobody@example.com', password: 'x' }));
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1_000_000;
  assert.ok(ms > 5, `unknown-email login too fast (${ms.toFixed(1)}ms); not timing-safe`);
});

test('logout: invalidates the session', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const email = newEmail();
  const password = makePassword();
  const reg = await svc().register({ email, password });

  await svc().logout(reg.sessionToken);

  const session = await db().session.findFirst({ where: { userId: reg.user.id } });
  assert.ok(session);
  assert.notEqual(session.revokedAt, null);
});

test('logout: unknown token is a no-op', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  await svc().logout('not-a-real-token-value');
});

test('logout-all: revokes every session for one user, leaves others alone', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const emailA = newEmail();
  const emailB = newEmail();
  const password = makePassword();
  const regA = await svc().register({ email: emailA, password });
  const regB = await svc().register({ email: emailB, password });

  await svc().login({ email: emailA, password });

  await svc().logoutAll(regA.user.id);

  const aSessions = await db().session.findMany({ where: { userId: regA.user.id } });
  assert.ok(aSessions.every((s: { revokedAt: Date | null }) => s.revokedAt !== null));

  const bSessions = await db().session.findMany({ where: { userId: regB.user.id } });
  assert.ok(bSessions.every((s: { revokedAt: Date | null }) => s.revokedAt === null));
});

test('session: lookup by token returns user when valid, null otherwise', async (t) => {
  if (!process.env['RUN_DB_INTEGRATION']) {
    t.skip('RUN_DB_INTEGRATION not set');
    return;
  }
  const email = newEmail();
  const password = makePassword();
  const reg = await svc().register({ email, password });

  const valid = await svc().getSession(reg.sessionToken);
  assert.ok(valid);
  assert.equal(valid.user.email, email);

  const missing = await svc().getSession('not-a-real-token');
  assert.equal(missing, null);

  await svc().logout(reg.sessionToken);
  const afterLogout = await svc().getSession(reg.sessionToken);
  assert.equal(afterLogout, null);
});
