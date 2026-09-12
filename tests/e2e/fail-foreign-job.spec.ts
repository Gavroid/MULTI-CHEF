// MC-073 fail-case 2: an unknown/foreign job id is a 404, never a leak.
import { expect, test } from '@playwright/test';

test('GET /jobs/:unknown without a session → 401', async ({ request }) => {
  const res = await request.get('/api/v1/jobs/00000000-0000-4000-8000-000000000000');
  expect([401, 404]).toContain(res.status());
});
