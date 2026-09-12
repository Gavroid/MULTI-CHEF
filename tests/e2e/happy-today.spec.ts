// MC-073 happy path: register via API → login via the UI (sets the real
// session cookie + the mc_user localStorage marker) → stock the fridge
// from inside the page → /today → wizard → recommendation → accept
// (mock) → shopping list page.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const unique = Date.now();
const EMAIL = `e2e-${unique}@test.ru`;
const PASSWORD = 'Passw0rd-e2e';

test('register → login → stock the fridge → get a recommendation → accept it', async ({ page }) => {
  // 1. Register the account through the API (Idempotency-Key required).
  const register = await page.request.post('/api/v1/auth/register', {
    headers: { 'idempotency-key': randomUUID() },
    data: { email: EMAIL, password: PASSWORD, householdName: 'Семья E2E' },
  });
  expect(register.status()).toBe(201);

  // 2. Login through the UI form — the server sets the session cookie and
  //    the login screen writes the mc_user marker into localStorage.
  await page.goto('/auth/login');
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  const [loginResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST', { timeout: 15_000 }),
    page.getByRole('button', { name: /войти/i }).click(),
  ]);
  expect(loginResponse.status()).toBe(200);

  // 3. Stock the fridge from inside the page context: cookies and the
  //    CSRF token ride along; the Idempotency-Key must be a UUID.
  await page.goto('/fridge/add');
  await page.waitForTimeout(500);
  const added = await page.evaluate(async () => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('mc_csrf='))?.split('=')[1];
    const search = await fetch('/api/v1/ingredients?q=%D0%BC%D0%BE%D0%BB%D0%BE%D0%BA%D0%BE&limit=1', { credentials: 'include' });
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
      pantryLog = `${r.url()} -> ${r.status()} jar=${(await page.context().cookies()).map((c) => c.name).join('|')} body=${(await r.text()).slice(0, 100)}`;
    }
  });
  await page.goto('/today');
  await page.waitForTimeout(2500);
  console.log('[e2e-debug] /pantry/items:', pantryLog);
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
  await expect(page).toHaveURL(/\/shopping\//, { timeout: 15_000 });
});
