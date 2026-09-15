// E23 (T46-A/C) — API error-language acceptance.
// User.locale drives the human message of API errors via the contracts
// ERROR_MESSAGES dictionary + exception filter. Register → default ru →
// PATCH /auth/locale 'en' → the SAME domain error answers in English.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const BASE = process.env['E2E_BASE_URL'] ?? 'http://192.168.1.95:8080';
const unique = Date.now();
const EMAIL = `e2e-i18n-${unique}@test.ru`;
const PASSWORD = 'Passw0rd-e2e';
const FAKE_ULID = 'A'.repeat(26); // well-formed, guaranteed unknown

let sessionToken = '';
let csrfToken = '';

test.beforeAll(async ({ request }) => {
  let reg;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    reg = await request.post(`${BASE}/api/v1/auth/register`, {
      headers: { 'idempotency-key': randomUUID() },
      data: { email: EMAIL, password: PASSWORD, householdName: 'I18N' },
    });
    if (reg.status() !== 429) break;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  expect(reg.status()).toBe(201);
  const body = await reg.json();
  sessionToken = body.sessionToken;
  for (const h of reg.headersArray()) {
    if (h.name.toLowerCase() === 'set-cookie') {
      const m = /mc_csrf=([^;]+)/.exec(h.value);
      if (m) csrfToken = m[1] as string;
    }
  }
});

function seed(page: import('@playwright/test').Page): void {
  // Cookies ride on the browser context; page.request shares them.
  void page.context().addCookies([
    { name: 'mc_session', value: sessionToken, url: BASE, httpOnly: true, sameSite: 'Lax' },
    { name: 'mc_csrf', value: csrfToken, url: BASE, httpOnly: false, sameSite: 'Lax' },
  ]);
}

async function recipeNotFoundMessage(
  request: import('@playwright/test').APIRequestContext,
): Promise<string> {
  const res = await request.get(`${BASE}/api/v1/recipes/${FAKE_ULID}`);
  expect(res.status()).toBe(404);
  const body = await res.json();
  expect(body.error.code).toBe('RECIPE_NOT_FOUND');
  return body.error.message as string;
}

async function setLocale(
  request: import('@playwright/test').APIRequestContext,
  locale: string,
): Promise<void> {
  const res = await request.patch(`${BASE}/api/v1/auth/locale`, {
    headers: {
      'idempotency-key': randomUUID(),
      'x-csrf-token': csrfToken,
    },
    data: { locale },
  });
  expect(res.status()).toBe(200);
  expect((await res.json()).locale).toBe(locale);
}

test('API errors answer in ru by default, in en after the locale switch', async ({ page }) => {
  seed(page);
  // Default (User.locale = 'ru' at registration).
  expect(await recipeNotFoundMessage(page.request)).toBe('Рецепт не найден');

  // Switch to English — same error, English message.
  await setLocale(page.request, 'en');
  expect(await recipeNotFoundMessage(page.request)).toBe('Recipe not found');
  // The session reflects the persisted choice (User.locale, T46-C).
  const session = await page.request.get(`${BASE}/api/v1/auth/session`);
  expect((await session.json()).user.locale).toBe('en');

  // And back.
  await setLocale(page.request, 'ru');
  expect(await recipeNotFoundMessage(page.request)).toBe('Рецепт не найден');
});

test('PATCH /auth/locale without a session is 401 (ru message)', async ({ page }) => {
  // A cookie-less page context — no session, anonymous caller.
  const res = await page.request.patch(`${BASE}/api/v1/auth/locale`, {
    headers: { 'idempotency-key': randomUUID() },
    data: { locale: 'en' },
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.error.code).toBe('UNAUTHORIZED');
  expect(body.error.message).toBe('Требуется вход');
});
