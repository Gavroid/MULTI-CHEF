// MC-073 happy path: register via API → seed the session exactly as the
// real UI login leaves it (HttpOnly mc_session cookie + mc_user
// localStorage marker — AuthGuard redirects without the marker) → stock
// the fridge → /today → wizard → recommendation → accept (mock) →
// shopping list page.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

// Must match the NEXT_PUBLIC_APP_BASE_URL baked into the bundle —
// cookies are planted per-origin and pages run at the gateway origin.
const BASE = process.env['E2E_BASE_URL'] ?? 'http://192.168.1.95:8080';
const unique = Date.now();
const EMAIL = `e2e-${unique}@test.ru`;
const PASSWORD = 'Passw0rd-e2e';

test('register → stock the fridge → get a recommendation → accept it', async ({ page }) => {
  // Полный сценарий: регистрация + сток + визард + генерация плана
  // (джоба) + accept — 30-с дефолт мал.
  test.setTimeout(180_000);
  // 1. Register through the API (Idempotency-Key required). Auth endpoints
  //    are @Throttle(10/min) — retry 429s until the window frees up.
  let register;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    register = await page.request.post('/api/v1/auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      data: { email: EMAIL, password: PASSWORD, householdName: 'Семья E2E' },
    });
    if (register.status() !== 429) break;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  expect(register.status()).toBe(201);
  const registerBody = (await register.json()) as {
    sessionToken: string;
    user: { id: string; email: string };
    household: { id: string };
  };

  // 2. Seed the session state the real UI login produces. E25 CSRF hard
  //    mode: the login response also sets mc_csrf (double-submit token) —
  //    re-plant it from the register response, else authed mutations 403.
  let csrfToken = '';
  for (const h of register.headersArray()) {
    if (h.name.toLowerCase() === 'set-cookie') {
      const m = /mc_csrf=([^;]+)/.exec(h.value);
      if (m) csrfToken = m[1] as string;
    }
  }
  await page.context().addCookies([
    {
      name: 'mc_session',
      value: registerBody.sessionToken,
      url: BASE,
      httpOnly: true,
      sameSite: 'Lax',
    },
    ...(csrfToken
      ? [{ name: 'mc_csrf', value: csrfToken, url: BASE, httpOnly: false, sameSite: 'Lax' }]
      : []),
  ]);
  await page.addInitScript(
    (stored) => {
      window.localStorage.setItem('mc_user', JSON.stringify(stored));
    },
    {
      id: registerBody.user.id,
      email: registerBody.user.email,
      householdId: registerBody.household.id,
    },
  );

  // 3. Stock the fridge from inside the page context (cookies + CSRF
  //    token ride along; the Idempotency-Key must be a UUID).
  await page.goto('/today');
  await page.waitForTimeout(500);
  const added = await page.evaluate(async () => {
    const csrf = document.cookie
      .split('; ')
      .find((c) => c.startsWith('mc_csrf='))
      ?.split('=')[1];
    const search = await fetch(
      '/api/v1/ingredients?q=%D0%BC%D0%BE%D0%BB%D0%BE%D0%BA%D0%BE&limit=1',
      { credentials: 'include' },
    );
    const searchJson = await search.json();
    const ingredientId = searchJson.data?.[0]?.id;
    if (!ingredientId) return { ok: false, step: 'search' as const };
    const key = crypto.randomUUID ? crypto.randomUUID() : `e2e-${Math.random()}`;
    const res = await fetch('/api/v1/pantry/items', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      body: JSON.stringify({ ingredientId, quantityG: 1000 }),
    });
    return { ok: res.ok, status: res.status };
  });
  expect(added.ok, `fridge stocking failed: ${JSON.stringify(added)}`).toBeTruthy();

  // 4. /today → wizard → recommendation → accept (mock) → shopping list.
  let pantryLog = 'none';
  page.on('response', async (r) => {
    if (r.url().includes('/pantry/items')) {
      pantryLog = `${r.url()} -> ${r.status()} body=${(await r.text()).slice(0, 120)}`;
    }
  });
  await page.goto('/today');
  await page.waitForTimeout(2500);
  console.log('[e2e-debug] last pantry GET:', pantryLog);
  const hero = page.getByTestId('hero-cta');
  await expect(hero).toBeVisible({ timeout: 10_000 });
  await hero.click();
  await expect(page).toHaveURL(/\/today\/generate/);
  await page.getByTestId('wizard-step-next').click();
  await page.getByTestId('wizard-step-next').click();
  await page.getByTestId('wizard-submit').click();
  await expect(page).toHaveURL(/\/today\/result/, { timeout: 15_000 });
  await expect(page.locator('[data-testid^="option-"]').first()).toBeVisible();

  await page.locator('[data-testid^="accept-"]').first().click();
  await expect(page).toHaveURL(/\/shopping/, { timeout: 60_000 });
});
