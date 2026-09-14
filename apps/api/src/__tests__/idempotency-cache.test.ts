// Unit tests for the Idempotency replay cache (T15-A / T20-B).
// Uses the InMemoryIdempotencyStore so no Redis is needed; the
// interceptor logic under test is identical for both stores.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastValueFrom, of, throwError } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import {
  IdempotencyReplayInterceptor,
  InMemoryIdempotencyStore,
  IDEMPOTENCY_TTL_SECONDS,
} from '../common/idempotency-cache.js';
import { AppHttpException } from '../common/exception-filter.js';

interface CookieCall {
  name: string;
  value: string;
  options?: Record<string, unknown> | undefined;
}

function makeContext(opts: { method: string; url?: string; body?: unknown; key?: string }): {
  context: ExecutionContext;
  cookies: CookieCall[];
} {
  const cookies: CookieCall[] = [];
  const req = {
    method: opts.method,
    url: opts.url ?? '/api/v1/things',
    headers: opts.key === undefined ? {} : { 'idempotency-key': opts.key },
    body: opts.body,
  };
  const res = {
    setCookie: (name: string, value: string, options?: Record<string, unknown>) => {
      cookies.push({ name, value, options });
    },
  };
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
  return { context, cookies };
}

function makeHandler<T>(result: T, spy: { calls: number }): CallHandler {
  return {
    handle: () => {
      spy.calls += 1;
      return of(result);
    },
  };
}

test('first execution caches the response and reports the conventions TTL', async () => {
  const store = new InMemoryIdempotencyStore();
  let storedTtl = 0;
  const wrappedSet = store.set.bind(store);
  store.set = async (key, value, ttl) => {
    storedTtl = ttl;
    return wrappedSet(key, value, ttl);
  };
  const interceptor = new IdempotencyReplayInterceptor(store);
  const spy = { calls: 0 };
  const { context } = makeContext({ method: 'POST', body: { a: 1 }, key: 'key-first-run-0001' });

  const first = await interceptor.intercept(context, makeHandler({ ok: true }, spy));
  assert.deepEqual(await lastValueFrom(first), { ok: true });
  assert.equal(storedTtl, IDEMPOTENCY_TTL_SECONDS);
  assert.equal(storedTtl, 86_400); // conventions.md §3
  assert.equal(spy.calls, 1);
});

test('replay with same key + same body returns the cached response, handler not re-run', async () => {
  const store = new InMemoryIdempotencyStore();
  const interceptor = new IdempotencyReplayInterceptor(store);
  const spy = { calls: 0 };
  const key = 'key-replay-same-001';

  const ctx1 = makeContext({ method: 'POST', body: { a: 1 }, key });
  const run1 = await interceptor.intercept(ctx1.context, makeHandler({ token: 'abc' }, spy));
  await lastValueFrom(run1);

  const ctx2 = makeContext({ method: 'POST', body: { a: 1 }, key });
  const run2 = await interceptor.intercept(ctx2.context, makeHandler({ token: 'abc' }, spy));
  assert.deepEqual(await lastValueFrom(run2), { token: 'abc' });
  assert.equal(spy.calls, 1, 'handler must execute once; the replay serves the cache');
});

test('replay with same key + different body → 409 IDEMPOTENT_REPLAY', async () => {
  const store = new InMemoryIdempotencyStore();
  const interceptor = new IdempotencyReplayInterceptor(store);
  const spy = { calls: 0 };
  const key = 'key-replay-diff-0001';

  const ctx1 = makeContext({ method: 'POST', body: { a: 1 }, key });
  await lastValueFrom(await interceptor.intercept(ctx1.context, makeHandler({ ok: true }, spy)));

  const ctx2 = makeContext({ method: 'POST', body: { a: 2 }, key });
  await assert.rejects(
    () => interceptor.intercept(ctx2.context, makeHandler({ ok: true }, spy)),
    (err: unknown) => {
      assert.ok(err instanceof AppHttpException);
      assert.equal(err.code, 'IDEMPOTENT_REPLAY');
      return true;
    },
  );
});

test('GET requests bypass the cache entirely', async () => {
  const store = new InMemoryIdempotencyStore();
  const interceptor = new IdempotencyReplayInterceptor(store);
  const spy = { calls: 0 };
  const { context } = makeContext({ method: 'GET', key: 'key-get-bypass-00001' });

  const run = await interceptor.intercept(context, makeHandler({ ok: true }, spy));
  await lastValueFrom(run);
  assert.equal(spy.calls, 1);

  // Nothing was cached under any key derived from this request.
  assert.equal(store.entries.size, 0);
});

test('mutating request without a usable key is passed through (guard 400s elsewhere)', async () => {
  const store = new InMemoryIdempotencyStore();
  const interceptor = new IdempotencyReplayInterceptor(store);
  const spy = { calls: 0 };
  const { context } = makeContext({ method: 'POST', body: { a: 1 } });

  const run = await interceptor.intercept(context, makeHandler({ ok: true }, spy));
  await lastValueFrom(run);
  assert.equal(spy.calls, 1);
  assert.equal(store.entries.size, 0);
});

test('void responses (204-style routes) are cached and replayed as void', async () => {
  const store = new InMemoryIdempotencyStore();
  const interceptor = new IdempotencyReplayInterceptor(store);
  const spy = { calls: 0 };
  const key = 'key-void-replay-00001';

  const ctx1 = makeContext({ method: 'POST', body: {}, key });
  const run1 = await interceptor.intercept(ctx1.context, makeHandler(undefined, spy));
  assert.equal(await lastValueFrom(run1), undefined);

  const ctx2 = makeContext({ method: 'POST', body: {}, key });
  const run2 = await interceptor.intercept(ctx2.context, makeHandler(undefined, spy));
  assert.equal(await lastValueFrom(run2), undefined);
  assert.equal(spy.calls, 1);
});

test('setCookie side effects are captured and re-applied on replay', async () => {
  const store = new InMemoryIdempotencyStore();
  const interceptor = new IdempotencyReplayInterceptor(store);
  const spy = { calls: 0 };
  const key = 'key-cookie-replay-001';

  // First run: handler "sets" a session cookie as a side effect.
  const ctx1 = makeContext({ method: 'POST', body: {}, key });
  const handler1: CallHandler = {
    handle: () => {
      spy.calls += 1;
      const res = ctx1.context
        .switchToHttp()
        .getResponse<{ setCookie: (n: string, v: string) => void }>();
      res.setCookie('mc_session', 'token-1');
      return of({ sessionToken: 'token-1' });
    },
  };
  await lastValueFrom(await interceptor.intercept(ctx1.context, handler1));
  assert.equal(ctx1.cookies.length, 1);

  // Replay: handler does NOT run, but the cookie is re-applied.
  const ctx2 = makeContext({ method: 'POST', body: {}, key });
  const run2 = await interceptor.intercept(ctx2.context, makeHandler({ sessionToken: 'x' }, spy));
  assert.deepEqual(await lastValueFrom(run2), { sessionToken: 'token-1' });
  assert.equal(spy.calls, 1);
  assert.deepEqual(ctx2.cookies, [{ name: 'mc_session', value: 'token-1', options: undefined }]);
});

test('failed (throwing) executions are not cached — retry re-executes', async () => {
  const store = new InMemoryIdempotencyStore();
  const interceptor = new IdempotencyReplayInterceptor(store);
  const spy = { calls: 0 };
  const key = 'key-error-no-cache-01';

  const ctx1 = makeContext({ method: 'POST', body: {}, key });
  const failing: CallHandler = { handle: () => throwError(() => new Error('boom')) };
  await assert.rejects(
    async () => lastValueFrom(await interceptor.intercept(ctx1.context, failing)),
    /boom/,
  );

  // After the failure the next request with the same key executes again.
  const ctx2 = makeContext({ method: 'POST', body: {}, key });
  const ok = await interceptor.intercept(ctx2.context, makeHandler({ ok: true }, spy));
  assert.deepEqual(await lastValueFrom(ok), { ok: true });
  assert.equal(spy.calls, 1, 'the failed attempt must not have poisoned the cache');
});

test('store failure degrades to pass-through (fail-open)', async () => {
  const failingStore = {
    get: async () => {
      throw new Error('ECONNREFUSED');
    },
    set: async () => {
      throw new Error('ECONNREFUSED');
    },
    tryLock: async () => {
      throw new Error('ECONNREFUSED');
    },
    unlock: async () => {},
  };
  const interceptor = new IdempotencyReplayInterceptor(failingStore);
  const spy = { calls: 0 };
  const key = 'key-fail-open-0000001';

  const ctx = makeContext({ method: 'POST', body: { a: 1 }, key });
  const run = await interceptor.intercept(ctx.context, makeHandler({ ok: true }, spy));
  assert.deepEqual(await lastValueFrom(run), { ok: true });
  assert.equal(spy.calls, 1, 'request must execute when the cache is unreachable');
});
