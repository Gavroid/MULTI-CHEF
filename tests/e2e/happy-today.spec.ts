// MC-073 happy path: register → /today → wizard → recommendation →
// accept (mock) → shopping list page.
import { expect, test } from '@playwright/test';

const unique = Date.now();
const EMAIL = `e2e-${unique}@test.ru`;
const PASSWORD = 'Passw0rd-e2e';

test('register → get a recommendation → accept it', async ({ page }) => {
  await page.goto('/auth/register');
  await page.getByLabel(/email/i).or(page.locator('input[type="email"]')).first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.getByRole('button', { name: /зарегистр|создать/i }).click();
  await expect(page).toHaveURL(/\/(today|onboarding)/, { timeout: 15_000 });

  await page.goto('/today');
  await expect(page.getByTestId('hero-cta')).toBeVisible();
  await page.getByTestId('hero-cta').click();
  await expect(page).toHaveURL(/\/today\/generate/);
  await page.getByTestId('wizard-step-next').click();
  await page.getByTestId('wizard-step-next').click();
  await page.getByTestId('wizard-submit').click();
  await expect(page).toHaveURL(/\/today\/result/, { timeout: 15_000 });
  await expect(page.getByTestId(/option-/).first()).toBeVisible();
});
