import { test } from 'node:test';
import assert from 'node:assert/strict';

// MC-003: the database package now exposes real PrismaClient / PrismaPg
// helpers, but constructing them requires DATABASE_URL through
// @multichef/config. The integration tests in `integration.test.ts`
// cover the end-to-end happy path with a real Postgres container;
// this file just confirms the surface compiles and the symbols are
// importable.

test('database package re-exports the PrismaPg adapter helper and helper functions', async () => {
  const mod = await import('../index.js');
  // Re-exports — actual identity check is unnecessary; we just want
  // the named symbols to be present.
  // PrismaPg is re-exported from @prisma/adapter-pg (Prisma's driver
  // adapter package); the consumer is expected to construct it with
  // { connectionString } for the driver-adapter flow.
  assert.equal(typeof (mod as unknown as { PrismaPg: unknown }).PrismaPg, 'function');
  assert.equal(typeof (mod as unknown as { getPrisma: unknown }).getPrisma, 'function');
  assert.equal(typeof (mod as unknown as { closePrisma: unknown }).closePrisma, 'function');
  assert.equal(typeof (mod as unknown as { pingDatabase: unknown }).pingDatabase, 'function');
});

test('getPrisma throws a clear EnvValidationError when DATABASE_URL is missing', async () => {
  // Strip the variables @multichef/config requires so the loader fails
  // before any DB I/O. We restore them afterwards so other test files
  // (and the runner itself) stay clean.
  const saved: Record<string, string | undefined> = {
    DATABASE_URL: process.env['DATABASE_URL'],
    REDIS_URL: process.env['REDIS_URL'],
    SESSION_SECRET: process.env['SESSION_SECRET'],
    COOKIE_SECRET: process.env['COOKIE_SECRET'],
  };
  delete process.env['DATABASE_URL'];
  delete process.env['REDIS_URL'];
  delete process.env['SESSION_SECRET'];
  delete process.env['COOKIE_SECRET'];

  // Reload the module so the cached PrismaClient from a previous test
  // (if any) does not short-circuit the validation. Node's ESM cache
  // keys on the resolved URL, so we use a query string to force a
  // fresh evaluation.
  const url = `../index.js?v=${Date.now()}`;
  const fresh = await import(url);
  const getPrisma = (fresh as { getPrisma: () => unknown }).getPrisma;
  assert.throws(() => (getPrisma as () => void)(), /serverEnv failed validation|DATABASE_URL/);

  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
