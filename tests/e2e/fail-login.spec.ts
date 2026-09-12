// MC-073 fail-case 1: wrong password shows an error, no session.
import { expect, test } from '@playwright/test';

test('wrong password → inline error, no redirect to the app', async ({ page }) => {
  await page.goto('/auth/login');
  await page.locator('input[type="email"]').first().fill('nobody-e2e@test.ru');
  await page.locator('input[type="password"]').first().fill('WrongPass1');
  await page.getByRole('button', { name: /войти|login/i }).click();
  await expect(page.locator('text=/неверн|wrong|некоррект/i').first()).toBeVisible({ timeout: 10_000 });
});
