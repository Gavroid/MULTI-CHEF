// E26 (T69-D) — inbound webhook acceptance: signature verification,
// replay idempotency, schema validation, health introspection.
import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';

const BASE = process.env['E2E_BASE_URL'] ?? 'http://192.168.1.95:8080';
// The secret is provisioned in /etc/multichef/multichef.env (root-only).
// The e2e runner (multichef_app) reads the repo-local mirror instead.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
function loadSecret(): string {
  if (process.env['WEBHOOK_SIGNING_SECRET']) return process.env['WEBHOOK_SIGNING_SECRET'];
  try {
    return readFileSync(join(__dirname, '../../.webhook-test-secret'), 'utf-8').trim();
  } catch {
    return '';
  }
}
const SECRET = loadSecret();

function sign(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
}

function eventBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: `evt_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    type: 'integration.selftest',
    occurredAt: new Date().toISOString(),
    data: { ok: true },
    ...overrides,
  });
}

test('GET /webhooks/health reports the configured endpoint', async ({ request }) => {
  const res = await request.get(`${BASE}/api/v1/webhooks/health`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.endpoint).toBe('/api/v1/webhooks/inbound');
  expect(body.secretConfigured).toBe(true);
});

test('signed delivery is accepted; tampered body is 401', async ({ request }) => {
  const body = eventBody();
  const good = await request.post(`${BASE}/api/v1/webhooks/inbound`, {
    headers: {
      'Content-Type': 'application/json',
      'X-MC-Signature': sign(body),
      'X-MC-Event-Id': 'evt_spec',
    },
    data: body,
  });
  expect(good.status()).toBe(200);
  expect((await good.json()).received).toBe(true);

  // Sign the ORIGINAL bytes, deliver a tampered body — must 401.
  const tampered = `${body} `;
  const bad = await request.post(`${BASE}/api/v1/webhooks/inbound`, {
    headers: {
      'Content-Type': 'application/json',
      'X-MC-Signature': sign(body),
    },
    data: tampered,
  });
  expect(bad.status()).toBe(401);
  expect((await bad.json()).error.code).toBe('UNAUTHORIZED');
});

test('replay of the same event id is acked without error', async ({ request }) => {
  const body = eventBody({ id: `evt_replay_${Date.now()}` });
  const headers = {
    'Content-Type': 'application/json',
    'X-MC-Signature': sign(body),
  };
  const first = await request.post(`${BASE}/api/v1/webhooks/inbound`, { headers, data: body });
  expect(first.status()).toBe(200);
  const second = await request.post(`${BASE}/api/v1/webhooks/inbound`, { headers, data: body });
  expect(second.status()).toBe(200);
  expect((await second.json()).received).toBe(true);
});

test('malformed event (unknown field shape) is 400', async ({ request }) => {
  const body = JSON.stringify({ id: 'short', wrong: true });
  const res = await request.post(`${BASE}/api/v1/webhooks/inbound`, {
    headers: { 'Content-Type': 'application/json', 'X-MC-Signature': sign(body) },
    data: body,
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
});
