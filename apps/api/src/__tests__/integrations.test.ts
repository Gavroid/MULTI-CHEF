// E26 (T69-A/B/C/D): external integrations scaffold tests — resilient
// HTTP (timeout/retry/breaker), LLM provider fallback, webhook
// signature + idempotency. No network beyond a loopback http server.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signPayload, WebhooksService, verifySignature } from '../webhooks/webhooks.service.js';
import { ResilientHttp, CircuitOpenError } from '../recommendations/ai/resilient-http.js';
import { LlmAiProvider } from '../recommendations/ai/llm-provider.js';
import { TemplateAiProvider } from '../recommendations/ai/template-provider.js';

test('ResilientHttp retries 5xx then succeeds', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls < 3) return new Response('boom', { status: 500 });
    return Response.json({ ok: true });
  }) as typeof fetch;
  const http = new ResilientHttp({
    timeoutMs: 500,
    maxRetries: 3,
    breakerThreshold: 10,
    breakerCooldownMs: 1000,
    fetchImpl,
  });
  const out = await http.postJson('http://x/', {}, {});
  assert.equal(out.status, 200);
  assert.equal(calls, 3);
});

test('ResilientHttp does not retry 4xx', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('nope', { status: 400 });
  }) as typeof fetch;
  const http = new ResilientHttp({
    timeoutMs: 500,
    maxRetries: 3,
    breakerThreshold: 10,
    breakerCooldownMs: 1000,
    fetchImpl,
  });
  const out = await http.postJson('http://x/', {}, {});
  assert.equal(out.status, 400);
  assert.equal(calls, 1);
});

test('ResilientHttp circuit breaker opens after consecutive failures', async () => {
  const fetchImpl = (async () => new Response('boom', { status: 500 })) as typeof fetch;
  const http = new ResilientHttp({
    timeoutMs: 200,
    maxRetries: 0,
    breakerThreshold: 2,
    breakerCooldownMs: 60_000,
    fetchImpl,
  });
  await assert.rejects(() => http.postJson('http://x/', {}, {}));
  await assert.rejects(() => http.postJson('http://x/', {}, {}));
  await assert.rejects(() => http.postJson('http://x/', {}, {}), CircuitOpenError);
});

function templateFallback(): TemplateAiProvider {
  return new TemplateAiProvider();
}

const FULL_BREAKDOWN = {
  pantryMatch: { value: 0.9, weight: 1, contribution: 0.9 },
  expirationBenefit: { value: 0, weight: 1, contribution: 0 },
  budgetMatch: { value: 0, weight: 1, contribution: 0 },
  nutritionMatch: { value: 0, weight: 1, contribution: 0 },
  timeMatch: { value: 0, weight: 1, contribution: 0 },
  preferenceMatch: { value: 0, weight: 1, contribution: 0 },
  varietyScore: { value: 0, weight: 1, contribution: 0 },
  noveltyScore: { value: 0, weight: 1, contribution: 0 },
} as const;

test('LlmAiProvider uses the mock LLM text on 200 (openai shape)', async () => {
  const seenHeaders: Array<Record<string, string>> = [];
  const provider = new LlmAiProvider(
    {
      AI_LLM_ENABLED: 'true',
      AI_LLM_VENDOR: 'openai',
      AI_LLM_BASE_URL: 'http://mock/v1',
      AI_LLM_MODEL: 'mock-model',
      OPENAI_API_KEY: 'test-key',
      fetchImpl: (async (url: unknown, init?: { headers?: Record<string, string> }) => {
        seenHeaders.push(init?.headers ?? {});
        return Response.json({ choices: [{ message: { content: ' Отлично подходит!' } }] });
      }) as unknown as typeof fetch,
    },
    templateFallback(),
  );
  const scored = {
    recipe: { id: 'r1', title: 'Омлет' },
    score: 0.8,
    passed: true,
    breakdown: FULL_BREAKDOWN,
  } as never;
  assert.equal(await provider.explainAsync(scored as never), 'Отлично подходит!');
  assert.equal(seenHeaders[0]?.['Authorization'], 'Bearer test-key');
});

test('LlmAiProvider falls back to the template on upstream failure', async () => {
  let calls = 0;
  const provider = new LlmAiProvider(
    {
      AI_LLM_ENABLED: 'true',
      AI_LLM_VENDOR: 'anthropic',
      AI_LLM_BASE_URL: 'http://mock',
      AI_LLM_MODEL: 'mock-model',
      ANTHROPIC_API_KEY: 'test-key',
      AI_LLM_MAX_RETRIES: '1',
      fetchImpl: (async () => {
        calls += 1;
        return new Response('boom', { status: 500 });
      }) as unknown as typeof fetch,
    },
    templateFallback(),
  );
  const scored = {
    recipe: { id: 'r1', title: 'Омлет' },
    score: 0.8,
    passed: true,
    breakdown: FULL_BREAKDOWN,
  } as never;
  const text = await provider.explainAsync(scored as never);
  assert.ok(text.length > 0, 'template fallback text');
  assert.equal(calls, 2); // initial + 1 retry
});

test('LlmAiProvider without a key answers template synchronously', () => {
  const provider = new LlmAiProvider({ AI_LLM_ENABLED: 'true' }, templateFallback());
  const scored = {
    recipe: { id: 'r1', title: 'Омлет' },
    score: 0.8,
    passed: true,
    breakdown: {
      pantryMatch: { value: 0.9, weight: 1, contribution: 0.9 },
      expirationBenefit: { value: 0, weight: 1, contribution: 0 },
      budgetMatch: { value: 0, weight: 1, contribution: 0 },
      nutritionMatch: { value: 0, weight: 1, contribution: 0 },
      timeMatch: { value: 0, weight: 1, contribution: 0 },
      preferenceMatch: { value: 0, weight: 1, contribution: 0 },
      varietyScore: { value: 0, weight: 1, contribution: 0 },
      noveltyScore: { value: 0, weight: 1, contribution: 0 },
    },
  } as never;
  assert.ok(provider.explain(scored as never).length > 0);
});

test('webhook signature: valid, tampered, missing', () => {
  const body = Buffer.from('{"id":"evt_12345678"}');
  const sig = signPayload('secret', body);
  assert.ok(sig.startsWith('sha256='));
  assert.ok(verifySignature('secret', body, sig));
  assert.ok(!verifySignature('secret', Buffer.from('tampered'), sig));
  assert.ok(!verifySignature('secret', body, undefined));
  assert.ok(!verifySignature('wrong-secret', body, sig));
});

test('webhook event ids are idempotent; unknown types ack unhandled', async () => {
  const svc = new WebhooksService();
  assert.equal(svc.claimEventId('evt_01JABC'), true);
  assert.equal(svc.claimEventId('evt_01JABC'), false);
  const out = await svc.dispatch({
    id: 'evt_x',
    type: 'unknown.event',
    occurredAt: '2026-09-16T00:00:00Z',
    data: {},
  });
  assert.equal(out.handled, false);
  let called = 0;
  svc.register('payment.succeeded', () => {
    called += 1;
  });
  await svc.dispatch({
    id: 'evt_y',
    type: 'payment.succeeded',
    occurredAt: '2026-09-16T00:00:00Z',
    data: {},
  });
  assert.equal(called, 1);
});
