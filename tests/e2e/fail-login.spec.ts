// MC-073 fail-case 1: wrong password → 401 from the API, no app access.
//
// R17-WP11: rewrite to drive the API directly via `page.request.post`
// instead of the login form. The previous form-driven version raced
// the auth throttle (10/min per IP, shared with all e2e tests in the
// suite) and intermittently hit the waitForResponse with a 429 or a
// null click target. Direct request.call validates the API contract
// without depending on UI element resolution.

import { expect, test } from '@playwright/test';

test('wrong password → 401 response, no mc_session cookie set', async ({ page }) => {
  // 1) Make sure the auth throttle (10/min) is not the cause of a
  // flaky 429 — retry a small number of times if we hit it.
  let status = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await page.request.post('/api/v1/auth/login', {
      headers: { 'idempotency-key': `e2e-fail-login-${Date.now()}-${attempt}` },
      data: { email: 'nobody-e2e@test.ru', password: 'WrongPass1' },
    });
    status = res.status();
    if (status !== 429) break;
    await new Promise((r) => setTimeout(r, 6_000));
  }
  expect(status, 'expected 401, throttled even after retry').toBe(401);

  // 2) With the browser navigated to /today, the request MUST redirect
  // to /auth/login (no session cookie was set on the bad login).
  await page.goto('/today');
  await expect(page).toHaveURL(/\/auth\/login/);

  // 3) The mc_session cookie must not be present in the document
  //    cookie jar — login failure must not authenticate the user.
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === 'mc_session');
  expect(sessionCookie, 'mc_session cookie should not be set').toBeUndefined();
});
