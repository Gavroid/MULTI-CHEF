// Theme persistence: the stored choice (mc-theme in localStorage) must be
// applied by the root-layout inline script on every full page load — not
// only on pages that mount <ThemeToggle> (/, /design, /profile).
import { expect, test } from '@playwright/test';

test('stored dark theme applies on pages without ThemeToggle', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('mc-theme', 'dark');
  });

  await page.goto('/today');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.goto('/fridge');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('stored light theme overrides OS dark preference', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('mc-theme', 'light');
  });
  await page.emulateMedia({ colorScheme: 'dark' });

  await page.goto('/shopping');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
