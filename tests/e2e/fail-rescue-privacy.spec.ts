// MC-073 fail-case 3: mutations require the Idempotency-Key header and
// a session; rescue for a foreign/unknown ingredient never leaks.
import { expect, test } from '@playwright/test';

test('rescue without a session (but with idempotency key) → 401', async ({ request }) => {
  const res = await request.post('/api/v1/recommendations/rescue', {
    headers: { 'idempotency-key': `e2e-${Date.now()}` },
    data: { ingredientId: 'ghost-ingredient' },
  });
  expect(res.status()).toBe(401);
});
