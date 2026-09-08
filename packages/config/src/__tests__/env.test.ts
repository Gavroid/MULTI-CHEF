import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadServerEnv,
  loadWebEnv,
  parseServerEnv,
  EnvValidationError,
  trimEnvString,
} from '../index.js';

const REQUIRED_BASE: Record<string, string> = {
  NODE_ENV: 'development',
  API_PORT: '3001',
  APP_BASE_URL: 'http://localhost:3001',
  DATABASE_URL: 'postgresql://multichef:dev@127.0.0.1:5432/multichef',
  REDIS_URL: 'redis://127.0.0.1:6379',
  SESSION_SECRET: 'a'.repeat(32),
  COOKIE_SECRET: 'b'.repeat(32),
  CORS_ORIGINS: 'http://localhost:3000',
};

test('valid server env parses and exposes the expected values', () => {
  const env = loadServerEnv({ source: { ...REQUIRED_BASE, RATE_LIMIT_MAX_REQUESTS: '200' } });
  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.API_PORT, 3001);
  assert.equal(env.DATABASE_URL, 'postgresql://multichef:dev@127.0.0.1:5432/multichef');
  assert.equal(env.RATE_LIMIT_MAX_REQUESTS, 200);
  assert.deepEqual(env.CORS_ORIGINS, ['http://localhost:3000']);
  // Defaults applied
  assert.equal(env.SESSION_TTL_SECONDS, 2_592_000);
  assert.equal(env.COOKIE_SAMESITE, 'lax');
  assert.equal(env.LOG_LEVEL, 'info');
  assert.equal(env.LOG_FORMAT, 'pretty');
});

test('valid web env parses with NEXT_PUBLIC_APP_BASE_URL', () => {
  const env = loadWebEnv({
    source: { WEB_PORT: '4000', NEXT_PUBLIC_APP_BASE_URL: 'https://app.local' },
  });
  assert.equal(env.WEB_PORT, 4000);
  assert.equal(env.NEXT_PUBLIC_APP_BASE_URL, 'https://app.local');
});

test('missing required key surfaces a clear error', () => {
  const incomplete: Record<string, string> = { ...REQUIRED_BASE };
  delete incomplete['DATABASE_URL'];
  const result = parseServerEnv(incomplete);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.error instanceof EnvValidationError);
  const messages = result.error.issues.map((issue) => `${issue.path}: ${issue.message}`);
  assert.ok(
    messages.some((line) => line.startsWith('DATABASE_URL:')),
    `Expected DATABASE_URL in issues, got: ${messages.join(', ')}`,
  );
  assert.match(result.error.message, /serverEnv failed validation/);
  assert.match(result.error.message, /\.env\.example/);
});

test('invalid DATABASE_URL (wrong scheme) is rejected', () => {
  const bad: Record<string, string> = {
    ...REQUIRED_BASE,
    DATABASE_URL: 'mysql://localhost:3306/db',
  };
  const result = parseServerEnv(bad);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(
    result.error.issues.some(
      (issue) => issue.path === 'DATABASE_URL' && /postgresql/.test(issue.message),
    ),
  );
});

test('non-numeric API_PORT is rejected', () => {
  const bad: Record<string, string> = { ...REQUIRED_BASE, API_PORT: 'not-a-number' };
  const result = parseServerEnv(bad);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(
    result.error.issues.some((issue) => issue.path === 'API_PORT'),
    `Expected API_PORT in issues, got: ${JSON.stringify(result.error.issues)}`,
  );
});

test('SESSION_SECRET shorter than 32 chars is rejected', () => {
  const bad: Record<string, string> = { ...REQUIRED_BASE, SESSION_SECRET: 'short' };
  const result = parseServerEnv(bad);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.error.issues.some((issue) => issue.path === 'SESSION_SECRET'));
});

test('REDIS_URL must use redis:// or rediss://', () => {
  const bad: Record<string, string> = { ...REQUIRED_BASE, REDIS_URL: 'http://localhost:6379' };
  const result = parseServerEnv(bad);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(
    result.error.issues.some((issue) => issue.path === 'REDIS_URL' && /redis/.test(issue.message)),
  );
});

test('CORS_ORIGINS is split into a list and trimmed', () => {
  const env = loadServerEnv({
    source: { ...REQUIRED_BASE, CORS_ORIGINS: 'http://a.test, http://b.test , http://c.test' },
  });
  assert.deepEqual(env.CORS_ORIGINS, ['http://a.test', 'http://b.test', 'http://c.test']);
});

test('LOG_LEVEL rejects unknown values', () => {
  const bad: Record<string, string> = { ...REQUIRED_BASE, LOG_LEVEL: 'silly' };
  const result = parseServerEnv(bad);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.error.issues.some((issue) => issue.path === 'LOG_LEVEL'));
});

test('loadServerEnv throws EnvValidationError by default', () => {
  assert.throws(
    () => loadServerEnv({ source: {} }),
    (err: unknown) => err instanceof EnvValidationError,
  );
});

test('trimEnvString strips whitespace and control chars', () => {
  assert.equal(trimEnvString('  hello\r\n'), 'hello');
  assert.equal(trimEnvString('a\tb\vc'), 'abc');
  assert.equal(trimEnvString(42), 42);
});

test('NODE_ENV coerces to the right enum', () => {
  const env = loadServerEnv({ source: { ...REQUIRED_BASE, NODE_ENV: 'production' } });
  assert.equal(env.NODE_ENV, 'production');
});
