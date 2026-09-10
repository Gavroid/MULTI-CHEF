// e2e/recipe-page.spec.ts — MC-035 smoke (playwright).
//
// «открыть рецепт / изменить порции / добавить в план» against the
// fixture mode (NEXT_PUBLIC_USE_RECIPE_FIXTURES=1). Requires the dev
// servers from playwright.config.ts (API + web); the API is not
// actually hit for /recipes until MC-033 — the flag serves the local
// fixture catalog instead.

import { test, expect } from '@playwright/test';

test('recipe page: open, change servings, add to plan deep-link', async ({ page }) => {
  await page.goto('/recipe/r_pasta_grib');

  // Default state: 2 servings, ingredients tab.
  await expect(page.getByTestId('recipe-title')).toHaveText(/Паста с грибами/);
  await expect(page.getByTestId('servings-value')).toHaveText(/2/);

  // Stepper: 2 → 3, grams double-check via URL sync.
  await page.getByTestId('servings-stepper-plus').click();
  await expect(page.getByTestId('servings-value')).toHaveText(/3/);
  await expect(page).toHaveURL(/servings=3/);

  // Tabs: nutrition tab shows the §2.5.7 disclaimer.
  await page.getByTestId('tab-nutrition').click();
  await expect(page.getByTestId('nutrition-disclaimer')).toBeVisible();

  // Deep-link CTA carries recipeId + servings.
  await page.getByTestId('add-to-plan-button').click();
  await expect(page).toHaveURL(/\/plan\/setup\?recipeId=r_pasta_grib&servings=3/);
  await expect(page.getByTestId('plan-setup-placeholder')).toBeVisible();
});
