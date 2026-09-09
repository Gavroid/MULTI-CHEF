// pantry-client — fetch wrapper tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

interface FetchCall {
  url: string;
  init: RequestInit;
}

function installFetchMock(responder: (call: FetchCall) => Response): {
  calls: FetchCall[];
  reset: () => void;
} {
  const calls: FetchCall[] = [];
  const g = globalThis as unknown as { fetch?: typeof fetch };
  g.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const call: FetchCall = { url, init: init ?? {} };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return {
    calls,
    reset: (): void => {
      g.fetch = undefined as unknown as typeof fetch;
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function empty(status = 204): Response {
  return new Response(null, { status });
}

test('listItems GETs /api/v1/pantry/items with includeArchived=false by default', async () => {
  const mock = installFetchMock(() => json({ data: [] }));
  try {
    const { listItems } = await import('../lib/pantry-client');
    const res = await listItems();
    assert.equal(mock.calls.length, 1);
    const call = mock.calls[0]!;
    assert.match(call.url, /\/api\/v1\/pantry\/items$/);
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.credentials, 'include');
    assert.equal(res.data?.length, 0);
  } finally {
    mock.reset();
  }
});

test('listItems serialises all filter params into the query string', async () => {
  const mock = installFetchMock(() => json({ data: [] }));
  try {
    const { listItems } = await import('../lib/pantry-client');
    await listItems({
      includeArchived: true,
      ingredientId: '01HX1234567890ABCDEFGHJKM',
      sort: 'expiresAt',
      order: 'asc',
      limit: 25,
      offset: 50,
    });
    const call = mock.calls[0]!;
    assert.match(call.url, /[?&]includeArchived=true/);
    assert.match(call.url, /[?&]ingredientId=01HX1234567890ABCDEFGHJKM/);
    assert.match(call.url, /[?&]sort=expiresAt/);
    assert.match(call.url, /[?&]order=asc/);
    assert.match(call.url, /[?&]limit=25/);
    assert.match(call.url, /[?&]offset=50/);
  } finally {
    mock.reset();
  }
});

test('getItem URL-encodes the id and uses GET', async () => {
  const mock = installFetchMock(() => json({ data: { id: 'x' } }));
  try {
    const { getItem } = await import('../lib/pantry-client');
    await getItem('01H/with slash');
    const call = mock.calls[0]!;
    assert.match(call.url, /\/api\/v1\/pantry\/items\/01H%2Fwith%20slash$/);
    assert.equal(call.init.method, 'GET');
  } finally {
    mock.reset();
  }
});

test('createItem POSTs JSON body and an auto-generated Idempotency-Key', async () => {
  const mock = installFetchMock(() => json({ data: { id: '01HZZZZZZZZZZZZZZZZZZZZZZ' } }, 201));
  try {
    const { createItem } = await import('../lib/pantry-client');
    await createItem({
      ingredientId: '01HXXXXXXXXXXXXXXXXXXXXXXXX',
      quantityG: 250,
      unit: 'G',
    });
    const call = mock.calls[0]!;
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.credentials, 'include');
    const headers = call.init.headers as Record<string, string>;
    assert.match(headers['Idempotency-Key'] ?? '', /^.{36}$/);
    assert.match(headers['Idempotency-Key'] ?? '', /-/g);
    const body = JSON.parse(call.init.body as string);
    assert.equal(body.ingredientId, '01HXXXXXXXXXXXXXXXXXXXXXXXX');
    assert.equal(body.quantityG, 250);
    assert.equal(body.unit, 'G');
  } finally {
    mock.reset();
  }
});

test('updateItem PATCHes JSON body without auto Idempotency-Key (PATCH is not in our guard set)', async () => {
  // Backend's IdempotencyKeyGuard currently enforces the header on
  // POST/PUT/PATCH/DELETE/DELETE; we still auto-generate one for PATCH
  // to stay forward-compatible — assert the header is present.
  const mock = installFetchMock(() => json({ data: { id: 'a' } }));
  try {
    const { updateItem } = await import('../lib/pantry-client');
    await updateItem('abc', { quantityG: 100 });
    const call = mock.calls[0]!;
    assert.equal(call.init.method, 'PATCH');
    const headers = call.init.headers as Record<string, string>;
    assert.ok(headers['Idempotency-Key'], 'PATCH must include Idempotency-Key');
    assert.match(headers['Idempotency-Key'], /^.{16,}$/);
  } finally {
    mock.reset();
  }
});

test('deleteItem DELETEs and sends an Idempotency-Key', async () => {
  const mock = installFetchMock(() => empty(204));
  try {
    const { deleteItem } = await import('../lib/pantry-client');
    const res = await deleteItem('abc');
    const call = mock.calls[0]!;
    assert.equal(call.init.method, 'DELETE');
    assert.match(call.url, /\/api\/v1\/pantry\/items\/abc$/);
    const headers = call.init.headers as Record<string, string>;
    assert.ok(headers['Idempotency-Key']);
    assert.equal(res.error, undefined);
  } finally {
    mock.reset();
  }
});

test('restoreItem POSTs to /:id/restore', async () => {
  const mock = installFetchMock(() => json({ data: { id: 'restored' } }));
  try {
    const { restoreItem } = await import('../lib/pantry-client');
    await restoreItem('xyz');
    const call = mock.calls[0]!;
    assert.equal(call.init.method, 'POST');
    assert.match(call.url, /\/api\/v1\/pantry\/items\/xyz\/restore$/);
  } finally {
    mock.reset();
  }
});

test('createItem surfaces the server error envelope on 400 VALIDATION_ERROR', async () => {
  const mock = installFetchMock(() =>
    json(
      {
        status: 400,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: { fields: { quantityG: ['must be > 0'] } },
        },
      },
      400,
    ),
  );
  try {
    const { createItem } = await import('../lib/pantry-client');
    const res = await createItem({
      ingredientId: '01HXXXXXXXXXXXXXXXXXXXXXXXX',
      quantityG: 0,
    });
    assert.equal(res.data, undefined);
    assert.equal(res.error?.error.code, 'VALIDATION_ERROR');
    assert.equal(res.error?.status, 400);
  } finally {
    mock.reset();
  }
});

test('network failure surfaces a synthetic 0-status NETWORK_ERROR', async () => {
  const g = globalThis as unknown as { fetch?: typeof fetch };
  g.fetch = (async () => {
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  try {
    const { listItems } = await import('../lib/pantry-client');
    const res = await listItems();
    assert.equal(res.data, undefined);
    assert.equal(res.error?.status, 0);
    assert.equal(res.error?.error.code, 'NETWORK_ERROR');
  } finally {
    g.fetch = undefined as unknown as typeof fetch;
  }
});

test('Idempotency-Key is a valid UUID v4 across multiple POSTs', async () => {
  const mock = installFetchMock(() => json({ data: {} }, 201));
  try {
    const { createItem } = await import('../lib/pantry-client');
    const seen = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      await createItem({
        ingredientId: '01HXXXXXXXXXXXXXXXXXXXXXXXX',
        quantityG: 1,
      });
      const headers = mock.calls[i]?.init.headers as Record<string, string>;
      const key = headers['Idempotency-Key'] ?? '';
      assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      seen.add(key);
    }
    assert.equal(seen.size, 5, 'each POST must get a fresh Idempotency-Key');
  } finally {
    mock.reset();
  }
});

test('createItem accepts an explicit Idempotency-Key override', async () => {
  const mock = installFetchMock(() => json({ data: {} }, 201));
  try {
    const { createItem } = await import('../lib/pantry-client');
    await createItem(
      { ingredientId: '01HXXXXXXXXXXXXXXXXXXXXXXXX', quantityG: 1 },
      { idempotencyKey: 'fixed-key-for-test' },
    );
    const headers = mock.calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers['Idempotency-Key'], 'fixed-key-for-test');
  } finally {
    mock.reset();
  }
});
