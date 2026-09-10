// MC-033 — Integration tests for /recipes (public catalog) and
// /recommendations/today: boots its OWN harness in before().
// Wire format: { items, nextCursor } for lists; recipe object at top
// level for detail (conventions.md §2).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, type Mc033Harness } from './mc033-harness.js';

const RUN = !!process.env['RUN_DB_INTEGRATION'];
let H: Mc033Harness | undefined;

before(async () => {
  if (RUN) H = await setup();
});
after(async () => {
  if (RUN) await teardown();
});

function t(name: string, fn: (harness: Mc033Harness) => Promise<void>): void {
  test(name, async (ctx) => {
    if (!RUN) return ctx.skip('RUN_DB_INTEGRATION not set');
    if (!H) return ctx.skip('harness unavailable');
    await fn(H);
  });
}

// --- /recipes (public) ---

t('GET /recipes without cookie → 200 non-empty', async (harness) => {
  const res = await harness.get('/api/v1/recipes');
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as { items: unknown[]; nextCursor: string | null };
  assert.ok(Array.isArray(body.items));
  assert.ok(body.items.length > 0);
});

t('GET /recipes?mealType=DINNER filters by mealTypes has', async (harness) => {
  const res = await harness.get('/api/v1/recipes?mealType=DINNER');
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as { items: Array<{ mealTypes: string[] }> };
  assert.ok(body.items.length > 0);
  for (const item of body.items) {
    assert.ok(item.mealTypes.includes('DINNER'));
  }
});

t('GET /recipes?maxMinutes=15 returns only fast recipes', async (harness) => {
  const res = await harness.get('/api/v1/recipes?maxMinutes=15');
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as {
    items: Array<{ prepMinutes: number; cookMinutes: number }>;
  };
  for (const item of body.items) {
    assert.ok(item.prepMinutes <= 15 && item.cookMinutes <= 15);
  }
});

t('GET /recipes pagination: limit + cursor walk without duplicates', async (harness) => {
  const seen = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  do {
    const qs = `/api/v1/recipes?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await harness.get(qs);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    for (const item of body.items) {
      assert.ok(!seen.has(item.id), `duplicate id ${item.id} across pages`);
      seen.add(item.id);
    }
    cursor = body.nextCursor;
    pages += 1;
  } while (cursor && pages < 60);
  assert.ok(pages >= 2, `expected >=2 pages, got ${pages}`);
  assert.ok(seen.size >= 200, `expected >=200 total recipes, got ${seen.size}`);
});

t('GET /recipes/:id returns detail with nutrition + storageRules', async (harness) => {
  const res = await harness.get(`/api/v1/recipes/${harness.firstRecipeId}`);
  assert.equal(res.statusCode, 200);
  const recipe = JSON.parse(res.body) as {
    id: string;
    nutrition: Record<string, unknown>;
    instructions: unknown[];
    ingredients: unknown[];
    storageRules: unknown[];
  };
  assert.equal(recipe.id, harness.firstRecipeId);
  assert.ok('nutrition' in recipe);
  assert.ok(Array.isArray(recipe.instructions));
  assert.ok(Array.isArray(recipe.ingredients));
  assert.ok(Array.isArray(recipe.storageRules));
});

t('GET /recipes/:id unknown id → 404 RECIPE_NOT_FOUND', async (harness) => {
  const res = await harness.get('/api/v1/recipes/nonexistent0000000000000000');
  assert.equal(res.statusCode, 404);
  const body = JSON.parse(res.body) as { error?: { code?: string } };
  assert.equal(body.error?.code, 'RECIPE_NOT_FOUND');
});

// --- /recommendations/today (auth) ---

t('POST /recommendations/today without cookie → 401', async (harness) => {
  const res = await harness.postNoAuth('/api/v1/recommendations/today', {});
  assert.equal(res.statusCode, 401);
});

t('POST /recommendations/today with session → exactly 3 options in order', async (harness) => {
  const res = await harness.post('/api/v1/recommendations/today', {});
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body) as {
    options: Array<{ type: string; recipe: { id: string }; explanation: string }>;
    nutritionAccuracy: string;
  };
  assert.equal(payload.options.length, 3);
  assert.deepEqual(
    payload.options.map((o) => o.type),
    ['FROM_PANTRY', 'BEST_MATCH', 'CHAIN'],
  );
  assert.equal(payload.nutritionAccuracy, 'ESTIMATED');
  for (const option of payload.options) {
    assert.ok(option.recipe.id);
    assert.ok(typeof option.explanation === 'string' && option.explanation.length > 0);
  }
});

t('POST /recommendations/today with empty pantry → 200 (FROM_PANTRY fallback)', async (harness) => {
  const res = await harness.post('/api/v1/recommendations/today', {});
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body) as { options: Array<{ type: string }> };
  assert.equal(payload.options[0]!.type, 'FROM_PANTRY');
});

t(
  'POST /recommendations/today antiFilters NOT_CHICKEN_AGAIN with chicken yesterday',
  async (harness) => {
    await harness.seedChickenDinnerYesterday();
    const res = await harness.post('/api/v1/recommendations/today', {
      generationSettings: { antiFilters: ['NOT_CHICKEN_AGAIN'] },
    });
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body) as {
      options: Array<{ recipe: { ingredients?: Array<{ canonicalName: string }> } }>;
    };
    const chickenRe = /куриц|цыпл|бройлер/i;
    for (const option of payload.options) {
      for (const ingredient of option.recipe.ingredients ?? []) {
        assert.ok(
          !chickenRe.test(ingredient.canonicalName),
          `chicken leaked: ${ingredient.canonicalName}`,
        );
      }
    }
  },
);

t('POST /recommendations/today latency p95 < 500 ms over 10 runs', async (harness) => {
  const durations: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const started = process.hrtime.bigint();
    const res = await harness.post('/api/v1/recommendations/today', {});
    assert.equal(res.statusCode, 200);
    durations.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  durations.sort((a, b) => a - b);
  // p95 over 10 samples = 9th sorted value (ceil(0.95*10)); the DoD
  // metric is server-side compute, so first-call JIT warmup must not
  // mask it — take the median AND the 9th, assert both < 500.
  const median = durations[Math.floor(durations.length / 2)]!;
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!;
  assert.ok(
    p95 < 500,
    `p95 ${p95.toFixed(1)} ms >= 500; runs: ${durations.map((d) => d.toFixed(0)).join(',')}`,
  );
  assert.ok(
    median < 500,
    `median ${median.toFixed(1)} ms >= 500; runs: ${durations.map((d) => d.toFixed(0)).join(',')}`,
  );
});
