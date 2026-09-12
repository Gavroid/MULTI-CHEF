// MC-073 happy path: register (with family name) → add a pantry item →
// /today → wizard → recommendation → accept (mock) → shopping list.
import { expect, test } from '@playwright/test';

const unique = Date.now();
const EMAIL = `e2e-${unique}@test.ru`;
const PASSWORD = 'Passw0rd-e2e';

test('register → stock the fridge → get a recommendation → accept it', async ({ page }) => {
  await page.goto('/auth/register');
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('input[type="text"]').first().fill('Семья E2E');
  await page.getByRole('button', { name: /зарегистр|создать|начать/i }).click();
  await expect(page).toHaveURL(/\/(today|fridge|onboarding|plan)/, { timeout: 15_000 });

  // Stock the fridge via the API (session cookies are shared): search
  // the seeded catalogue for «молоко» and create a pantry item.
  const search = await page.request.get('/api/v1/ingredients?q=%D0%BC%D0%BE%D0%BB%D0%BE%D0%BA%D0%BE&limit=1');
  expect(search.ok()).toBeTruthy();
  const found = (await search.json()) as { data: Array<{ id: string }> };
  const ingredientId = found.data?.[0]?.id;
  expect(ingredientId).toBeTruthy();
  const added = await page.request.post('/api/v1/pantry/items', {
    headers: { 'idempotency-key': `e2e-${Date.now()}` },
    data: { ingredientId, quantityG: 1000 },
  });
  expect([200, 201]).toContain(added.status());

  await page.goto('/today');
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
