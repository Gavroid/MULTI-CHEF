// MC-073 fail-case 3: rescue for an ingredient not in the pantry is a
// private 404 (no session → 401; with a session → 404 INGREDIENT_NOT_FOUND).
import { expect, test } from '@playwright/test';

test('rescue without a session → 401 (privacy invariant)', async ({ request }) => {
  const res = await request.post('/api/v1/recommendations/rescue', {
    data: { ingredientId: 'ghost-ingredient' },
  });
  expect(res.status()).toBe(401);
});
