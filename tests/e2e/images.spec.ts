// E24 (T54-A/C/D) — image storage + upload acceptance.
// 1. Seeded catalog image serves 200 image/webp through the API route
//    (nginx X-Accel internal location) — no more broken-image fallback.
// 2. POST /uploads/image stores bytes (magic-byte validated) and the
//    returned url serves the same bytes.
// 3. POST /recipes/:id/image on a GLOBAL recipe is 403 (owner-only).
// 4. Text bytes with an image Content-Type are 400; oversize is 4xx.
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const BASE = process.env['E2E_BASE_URL'] ?? 'http://192.168.1.95:8080';
const unique = Date.now();
const EMAIL = `e2e-img-${unique}@test.ru`;
const PASSWORD = 'Passw0rd-e2e';

let sessionToken = '';
let csrfToken = '';

const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
  Buffer.from('VP8 ', 'ascii'),
  Buffer.alloc(12, 0),
]);

async function register(request: APIRequestContext): Promise<void> {
  let reg;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    reg = await request.post(`${BASE}/api/v1/auth/register`, {
      headers: { 'idempotency-key': randomUUID() },
      data: { email: EMAIL, password: PASSWORD, householdName: 'Images' },
    });
    if (reg.status() !== 429) break;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  expect(reg!.status()).toBe(201);
  const body = await reg!.json();
  sessionToken = body.sessionToken;
  for (const h of reg!.headersArray()) {
    if (h.name.toLowerCase() === 'set-cookie') {
      const m = /mc_csrf=([^;]+)/.exec(h.value);
      if (m) csrfToken = m[1] as string;
    }
  }
}

function seed(page: Page): void {
  void page.context().addCookies([
    { name: 'mc_session', value: sessionToken, url: BASE, httpOnly: true, sameSite: 'Lax' },
    { name: 'mc_csrf', value: csrfToken, url: BASE, httpOnly: false, sameSite: 'Lax' },
  ]);
}

test.beforeAll(async ({ request }) => {
  await register(request);
});

test('seeded catalog recipe image serves 200 image/webp (X-Accel)', async ({ request }) => {
  const list = await request.get(`${BASE}/api/v1/recipes?limit=1`);
  expect(list.status()).toBe(200);
  const { items } = (await list.json()) as {
    items: Array<{ id: string; imageKey: string | null }>;
  };
  expect(items.length).toBeGreaterThan(0);
  const { id, imageKey } = items[0];
  expect(imageKey, 'seeded recipe must have an imageKey').toBeTruthy();
  expect(imageKey).toMatch(/^recipes\//);

  const res = await request.get(`${BASE}/api/v1/images/${imageKey}`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/webp');
  const body = await res.body();
  expect(body.length).toBeGreaterThan(100);
  expect(body.subarray(0, 4).toString('ascii')).toBe('RIFF');

  // ...and the recipe page itself resolves the SAME url via the API.
  const detail = await request.get(`${BASE}/api/v1/recipes/${id}`);
  expect((await detail.json()).imageKey).toBe(imageKey);
});

test('upload -> serve round-trip, then owner-scoped attach rules', async ({ page }) => {
  seed(page);
  const res = await page.request.post(`${BASE}/api/v1/uploads/image`, {
    headers: {
      'Content-Type': 'image/webp',
      'Idempotency-Key': randomUUID(),
      'X-CSRF-Token': csrfToken,
    },
    data: WEBP_BYTES,
  });
  expect(res.status()).toBe(201);
  const { key, url } = (await res.json()) as { key: string; url: string };
  expect(key).toMatch(/^recipes\/u\//);

  const served = await page.request.get(`${BASE}${url}`);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toContain('image/webp');
  expect((await served.body()).length).toBe(WEBP_BYTES.length);

  // Global catalog recipe: only the OWNING household may attach → 403.
  const list = await page.request.get(`${BASE}/api/v1/recipes?limit=1`);
  const { items } = (await list.json()) as { items: Array<{ id: string }> };
  const attach = await page.request.post(`${BASE}/api/v1/recipes/${items[0].id}/image`, {
    headers: {
      'Content-Type': 'image/webp',
      'Idempotency-Key': randomUUID(),
      'X-CSRF-Token': csrfToken,
    },
    data: WEBP_BYTES,
  });
  expect(attach.status()).toBe(403);
  expect((await attach.json()).error.code).toBe('FORBIDDEN');
});

test('validation: text bytes as image → 400; oversized body → 4xx', async ({ page }) => {
  seed(page);
  const bad = await page.request.post(`${BASE}/api/v1/uploads/image`, {
    headers: {
      'Content-Type': 'image/webp',
      'Idempotency-Key': randomUUID(),
      'X-CSRF-Token': csrfToken,
    },
    data: Buffer.from('<html>this is not an image</html>'),
  });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error.code).toBe('VALIDATION_ERROR');

  const big = await page.request.post(`${BASE}/api/v1/uploads/image`, {
    headers: {
      'Content-Type': 'image/png',
      'Idempotency-Key': randomUUID(),
      'X-CSRF-Token': csrfToken,
    },
    data: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(7 * 1024 * 1024)]),
  });
  expect(big.status()).toBeGreaterThanOrEqual(400);
  expect(big.status()).toBeLessThan(500);
});
