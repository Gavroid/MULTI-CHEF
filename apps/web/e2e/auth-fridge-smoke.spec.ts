// MC-SMOKE-AUTH-FRIDGE — browser-driven end-to-end smoke.
//
// Goal: confirm the auth + fridge flows that source-regression +
// happy-dom can't reach. Specifically:
//   - cookies flow correctly through the browser
//   - the Next dev bundle actually compiles
//   - localStorage `mc_user` gets set after login
//   - the FAB + autocomplete + submit all round-trip a real API call
//   - the resulting PantryItemCard renders in the DOM
//
// Failure modes we explicitly look for:
//   - missing Prisma migrations on the DB (caught: `archivedAt` col
//     missing on the seeded test DB)
//   - CORS misconfiguration
//   - redirect target wrong (e.g. login form submits to /today
//     but page renders elsewhere)
//   - `credentials: 'include'` missing on fetch

import { test, expect, type APIRequestContext } from '@playwright/test';

const API_BASE = process.env['NEXT_PUBLIC_APP_BASE_URL'] ?? 'http://localhost:3001';

// Per-test email is unique so parallel runs don't collide on
// mc_user / mc_session rows. (We run with workers=1 anyway but
// the pattern is cheap and keeps flakes away.)
function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
}

async function registerViaApi(request: APIRequestContext, email: string): Promise<void> {
  // The Idempotency-Key is required by apps/api/src/common/idempotency.ts
  // (global APP_GUARD). We mint one in the test rather than reusing
  // auth-client's helper so this spec stays self-contained.
  const key = crypto.randomUUID();
  const res = await request.post(`${API_BASE}/api/v1/auth/register`, {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    data: { email, password: 'TestPass123', householdName: 'E2E Семья' },
  });
  expect(res.status(), `register returned ${res.status()} — body: ${await res.text()}`).toBe(201);
}

test.describe('MC-SMOKE-AUTH-FRIDGE', () => {
  test('login flow: real form submit, redirect, localStorage mc_user', async ({
    page,
    request,
  }) => {
    const email = uniqueEmail();
    await registerViaApi(request, email);

    // Trace network calls so we can attribute failures (CORS, 4xx, etc.).
    page.on('request', (req) => {
      if (req.url().includes('/api/')) {
        console.log(`[req] ${req.method()} ${req.url()}`);
      }
    });
    page.on('response', (res) => {
      if (res.url().includes('/api/')) {
        console.log(`[res] ${res.status()} ${res.url()}`);
      }
    });
    page.on('requestfailed', (req) => {
      if (req.url().includes('/api/')) {
        console.log(`[fail] ${req.failure()?.errorText} ${req.url()}`);
      }
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`[console.error] ${msg.text()}`);
    });

    // ── Open the login page ───────────────────────────────────────
    await page.goto('/auth/login');
    await expect(page).toHaveTitle(/.+/); // any title — proves the dev bundle ran
    await expect(page.getByLabel('Email')).toBeVisible();

    // ── Fill + submit ─────────────────────────────────────────────
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Пароль', { exact: false }).fill('TestPass123');
    await page.getByRole('button', { name: /Войти/i }).click();

    // Give the form a moment to settle (it may redirect OR may set an error).
    await page.waitForTimeout(2_000);
    console.log(`[debug] url after submit: ${page.url()}`);

    // ── Assert: redirected to /today (LoginPage default target) ───
    await page.waitForURL((url) => !url.pathname.startsWith('/auth/'), { timeout: 10_000 });
    expect(page.url(), 'login should redirect away from /auth/login').not.toContain('/auth/login');
    // The default redirect target in LoginForm is '/today'.
    expect(new URL(page.url()).pathname, 'login should land on /today').toMatch(/^\/today$|\/$/);

    // ── Assert: localStorage `mc_user` is set with the right email
    const mcUser = await page.evaluate(() => window.localStorage.getItem('mc_user'));
    expect(mcUser, 'mc_user must be set in localStorage after login').toBeTruthy();
    const parsed = JSON.parse(mcUser ?? '{}') as { email?: string };
    expect(parsed.email, 'mc_user.email should match the registered email').toBe(email);

    // ── Assert: mc_session cookie is HttpOnly (browser sees it but JS can't read it)
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => c.name === 'mc_session');
    expect(session, 'mc_session cookie must be set').toBeTruthy();
    expect(session?.httpOnly, 'mc_session must be HttpOnly').toBe(true);
  });

  test('add to fridge: FAB → autocomplete → submit → card renders', async ({ page, request }) => {
    const email = uniqueEmail();
    await registerViaApi(request, email);

    // Trace network calls so we can attribute failures (CORS, 4xx, etc.).
    page.on('request', (req) => {
      if (req.url().includes('/api/')) console.log(`[req] ${req.method()} ${req.url()}`);
    });
    page.on('response', (res) => {
      if (res.url().includes('/api/')) console.log(`[res] ${res.status()} ${res.url()}`);
    });
    page.on('requestfailed', (req) => {
      if (req.url().includes('/api/'))
        console.log(`[fail] ${req.failure()?.errorText} ${req.url()}`);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`[console.error] ${msg.text()}`);
    });

    // ── Log in through the UI ────────────────────────────────────
    await page.goto('/auth/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Пароль', { exact: false }).fill('TestPass123');
    await page.getByRole('button', { name: /Войти/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/auth/'));

    // ── Navigate to /fridge ───────────────────────────────────────
    await page.goto('/fridge');
    await expect(page.getByRole('heading', { name: 'Холодильник' })).toBeVisible();

    // The page renders the empty state until the API returns. We
    // wait for either the empty state OR the FAB so we know hydration
    // is done.
    await expect(page.getByTestId('fridge-fab')).toBeVisible();

    // ── Open the Add dialog via the FAB ───────────────────────────
    await page.getByTestId('fridge-fab').click();
    // Multiple dialogs share `data-testid="pantry-dialog"` (Add, Edit,
    // Confirm). Scope to the Add one via its heading.
    const dialog = page.getByRole('dialog').filter({ hasText: 'Добавить продукт' });
    await expect(dialog).toBeVisible();

    // ── Type into the ingredient field — autocomplete debounce 300ms ──
    const ingredientInput = dialog.getByTestId('add-pantry-ingredient-input');
    await ingredientInput.fill('помидор');
    // Wait for the dropdown list (300ms debounce + network).
    const ingredientList = dialog.getByTestId('add-pantry-ingredient-list');
    await expect(ingredientList).toBeVisible({ timeout: 5_000 });

    // Click the first result (whatever canonical name matched).
    const firstResult = ingredientList.getByRole('button').first();
    const resultText = (await firstResult.textContent()) ?? '';
    expect(resultText.length, 'autocomplete result must have text').toBeGreaterThan(0);
    await firstResult.click();

    // ── Set quantity to 250 and submit ────────────────────────────
    await dialog.getByTestId('add-pantry-quantity').fill('250');
    await dialog.getByTestId('add-pantry-submit').click();

    // Dialog should close on success.
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // ── Assert: a PantryItemCard appeared in the list ─────────────
    // The card has data-testid="pantry-item-<ulid>" (one per item).
    const cards = page.locator('[data-testid^="pantry-item-"]').filter({
      hasNot: page.getByTestId(/.*archived-badge.*/),
    });
    await expect(cards.first(), 'at least one PantryItemCard must render').toBeVisible({
      timeout: 5_000,
    });
    // The card shows the quantity "250 г" (g suffix for G unit).
    await expect(cards.first()).toContainText(/250/);
  });
});
