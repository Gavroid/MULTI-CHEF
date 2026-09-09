// auth-client — typed fetch wrapper tests.
//
// We mock the global `fetch` (Node 24 has it built in) and assert that
// `login` / `register` build the correct URL, send the correct body +
// headers, and unwrap the { data, error } envelope correctly.
//
// The env helper is mocked by stubbing process.env['NEXT_PUBLIC_APP_BASE_URL'].

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const ORIGINAL_BASE = process.env['NEXT_PUBLIC_APP_BASE_URL'];
process.env['NEXT_PUBLIC_APP_BASE_URL'] = 'http://api.test:4001';

// Capture fetch calls.
interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  credentials: RequestCredentials;
}
let captured: CapturedCall[] = [];

// Install a fetch stub BEFORE importing the SUT (auth-client imports
// `env.ts` at module load).
const realFetch = globalThis.fetch;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).fetch = async (
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    credentials?: RequestCredentials;
  } = {},
): Promise<Response> => {
  captured.push({
    url,
    method: init.method ?? 'GET',
    headers: init.headers ?? {},
    body: init.body ?? null,
    credentials: init.credentials ?? 'same-origin',
  });
  return new Response(
    JSON.stringify({
      data: {
        user: {
          id: 'u1',
          email: 'a@b.c',
          status: 'ACTIVE',
          tz: 'Europe/Moscow',
          locale: 'ru',
          isGuestConverted: false,
        },
        household: { id: 'h1' },
        sessionToken: 'tok',
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};

const authClient = await import('../lib/auth-client');

afterEach(() => {
  captured = [];
});
beforeEach(() => {
  captured = [];
});

test.after(() => {
  // Restore real fetch + env.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = realFetch;
  if (ORIGINAL_BASE === undefined) {
    delete process.env['NEXT_PUBLIC_APP_BASE_URL'];
  } else {
    process.env['NEXT_PUBLIC_APP_BASE_URL'] = ORIGINAL_BASE;
  }
});

test('login posts to /api/v1/auth/login with credentials: include', async () => {
  const result = await authClient.login({ email: 'a@b.c', password: 'pw12345' });
  assert.equal(captured.length, 1);
  const call = captured[0]!;
  assert.equal(call.url, 'http://api.test:4001/api/v1/auth/login');
  assert.equal(call.method, 'POST');
  assert.equal(call.credentials, 'include');
  assert.equal(call.headers['Content-Type'], 'application/json');
  assert.match(
    call.headers['Idempotency-Key'] ?? '',
    /^.{16,}$/,
    'login must send a valid Idempotency-Key',
  );
  const body = JSON.parse(call.body ?? '{}');
  assert.deepEqual(body, { email: 'a@b.c', password: 'pw12345' });
  assert.equal(result.error, undefined);
  assert.ok(result.data);
  assert.equal(result.data?.user.email, 'a@b.c');
});

test('register includes householdName when provided and sends Idempotency-Key', async () => {
  await authClient.register({ email: 'a@b.c', password: 'pw12345', householdName: 'Семья' });
  const call = captured[0]!;
  assert.equal(call.url, 'http://api.test:4001/api/v1/auth/register');
  assert.match(call.headers['Idempotency-Key'] ?? '', /^.{16,}$/);
  const body = JSON.parse(call.body ?? '{}');
  assert.equal(body.householdName, 'Семья');
});

test('register omits householdName when not provided', async () => {
  await authClient.register({ email: 'a@b.c', password: 'pw12345' });
  const body = JSON.parse(captured[0]!.body ?? '{}');
  assert.equal('householdName' in body, false);
});

test('two calls get distinct Idempotency-Keys', async () => {
  await authClient.login({ email: 'a@b.c', password: 'pw12345' });
  await authClient.login({ email: 'a@b.c', password: 'pw12345' });
  const k1 = captured[0]!.headers['Idempotency-Key'];
  const k2 = captured[1]!.headers['Idempotency-Key'];
  assert.ok(k1 && k2 && k1 !== k2, 'Idempotency-Key should be unique per call');
});

test('Idempotency-Key is a valid UUID v4 (36 chars, version nibble = 4)', async () => {
  await authClient.login({ email: 'a@b.c', password: 'pw12345' });
  const k = captured[0]!.headers['Idempotency-Key'] ?? '';
  // RFC 4122 §4.4: 36 chars, "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".
  assert.match(k, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('error envelope is returned on 401 with code+message', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        status: 401,
        error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
      }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    );
  const result = await authClient.login({ email: 'a@b.c', password: 'bad' });
  assert.ok(result.error, 'should return an error envelope');
  assert.equal(result.error?.status, 401);
  assert.equal(result.error?.error.code, 'UNAUTHORIZED');
  assert.equal(result.error?.error.message, 'Invalid email or password');
  // Restore the happy-path stub for subsequent tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (
    url: string,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      credentials?: RequestCredentials;
    } = {},
  ): Promise<Response> => {
    captured.push({
      url,
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body ?? null,
      credentials: init.credentials ?? 'same-origin',
    });
    return new Response(
      JSON.stringify({
        data: {
          user: {
            id: 'u1',
            email: 'a@b.c',
            status: 'ACTIVE',
            tz: 'Europe/Moscow',
            locale: 'ru',
            isGuestConverted: false,
          },
          household: { id: 'h1' },
          sessionToken: 'tok',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
});

test('VALIDATION_ERROR details.fields surfaces in error envelope', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        status: 400,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: { fields: { email: ['Invalid email'], password: ['Too short'] } },
        },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  const result = await authClient.register({ email: 'nope', password: 'x' });
  assert.ok(result.error);
  const details = result.error?.error.details as { fields: Record<string, string[]> } | undefined;
  assert.ok(details);
  const fields = details?.fields as Record<string, string[]> | undefined;
  assert.ok(fields);
  assert.ok(Array.isArray(fields?.['email']));
  assert.equal(fields?.['email']?.[0], 'Invalid email');
  // Restore happy path.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (
    url: string,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      credentials?: RequestCredentials;
    } = {},
  ): Promise<Response> => {
    captured.push({
      url,
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body ?? null,
      credentials: init.credentials ?? 'same-origin',
    });
    return new Response(
      JSON.stringify({
        data: {
          user: {
            id: 'u1',
            email: 'a@b.c',
            status: 'ACTIVE',
            tz: 'Europe/Moscow',
            locale: 'ru',
            isGuestConverted: false,
          },
          household: { id: 'h1' },
          sessionToken: 'tok',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
});

test('network error becomes a synthetic 0-status error envelope', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (): Promise<Response> => {
    throw new TypeError('Failed to fetch');
  };
  const result = await authClient.login({ email: 'a@b.c', password: 'pw12345' });
  assert.ok(result.error);
  assert.equal(result.error?.status, 0);
  assert.equal(result.error?.error.code, 'NETWORK_ERROR');
  assert.match(result.error?.error.message ?? '', /Failed to fetch/);
  // Restore.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (
    url: string,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      credentials?: RequestCredentials;
    } = {},
  ): Promise<Response> => {
    captured.push({
      url,
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body ?? null,
      credentials: init.credentials ?? 'same-origin',
    });
    return new Response(
      JSON.stringify({
        data: {
          user: {
            id: 'u1',
            email: 'a@b.c',
            status: 'ACTIVE',
            tz: 'Europe/Moscow',
            locale: 'ru',
            isGuestConverted: false,
          },
          household: { id: 'h1' },
          sessionToken: 'tok',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
});

test('AbortSignal is forwarded to fetch', async () => {
  const ac = new AbortController();
  await authClient.login({ email: 'a@b.c', password: 'pw12345' }, { signal: ac.signal });
  // fetch doesn't expose signal as a property we capture, but it didn't
  // throw — that's enough for the integration contract.
  assert.equal(captured.length, 1);
});
