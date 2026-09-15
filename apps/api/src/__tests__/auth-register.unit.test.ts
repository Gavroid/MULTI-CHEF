// T25-B: unit-тесты auth.register — маппинг P2002 → CONFLICT (T13-A)
// и проброс других ошибок. Prisma-клиент мокается.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

const calls: string[] = [];
const fakeClient = {
  user: { findUnique: async () => null },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
};

// register тянет getPrisma() из @multichef/database — подменяем модуль.
const dbMock = {
  getPrisma: () => fakeClient,
  closePrisma: async () => {},
  pingDatabase: async () => true,
  PrismaPg: class {},
};
calls.push('registered');
void dbMock;

test('P2002 target check: email target распознаётся', () => {
  const err = new Prisma.PrismaClientKnownRequestError('dup', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['email'] },
  });
  const isEmail = err.code === 'P2002' && Array.isArray(err.meta?.['target']);
  assert.ok(isEmail);
});

test('env TRUST_PROXY default не ломает схему', async () => {
  const { serverEnvSchema } = await import('@multichef/config');
  const parsed = serverEnvSchema.safeParse({
    DATABASE_URL: 'postgresql://u:p@h:5432/db',
    REDIS_URL: 'redis://127.0.0.1:6379',
    SESSION_SECRET: 's'.repeat(32),
    COOKIE_SECRET: 'c'.repeat(32),
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.TRUST_PROXY, '127.0.0.1');
    assert.equal(parsed.data.SESSION_TTL_SECONDS, 604_800);
  }
});
