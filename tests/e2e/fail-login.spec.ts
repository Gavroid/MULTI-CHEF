// MC-073 fail-case 1: wrong password → 401 from the API, no app access.
import { expect, test } from '@playwright/test';

test('wrong password → 401 response, user stays on /auth/login', async ({ page }) => {
  await page.goto('/auth/login');
  await page.locator('input[type="email"]').first().fill('nobody-e2e@test.ru');
  await page.locator('input[type="password"]').first().fill('WrongPass1');

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST', { timeout: 15_000 }),
    page.getByRole('button', { name: /войти/i }).click(),
  ]);
  expect(response.status()).toBe(401);
  await expect(page).toHaveURL(/\/auth\/login/);
});
