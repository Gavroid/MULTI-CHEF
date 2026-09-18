// recommendations-client unit tests (MC-034): contract validation,
// mock accept flow, env-flag hygiene, deps injection.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  acceptRecommendation,
  getRecommendationsToday,
  usesMealPlanMock,
} from '../recommendations-client';
import type { TodayRecommendationDto } from '@multichef/contracts';

/* ---------------- fixture ---------------- */

const recipe = (id: string) => ({
  id,
  title: `Рецепт ${id}`,
  description: null,
  servings: 2,
  prepMinutes: 10,
  cookMinutes: 20,
  difficulty: 1,
  mealTypes: ['LUNCH' as const],
  tags: [] as string[],
  requiredAppliances: [] as string[],
});

const validRecommendation: TodayRecommendationDto = {
  options: [
    {
      type: 'FROM_PANTRY',
      recipe: recipe('r1'),
      score: 0.9,
      explanation: 'Всё есть дома',
      toBuyCount: 0,
      chainTag: null,
    },
    { type: 'BEST_MATCH', recipe: recipe('r2'), score: 0.7, explanation: 'Лучший на сегодня' },
    {
      type: 'CHAIN',
      recipe: recipe('r3'),
      score: 0.5,
      explanation: 'Цепочка на 3 дня',
      chainTag: 'курица-3-дня',
      chain: [recipe('r4'), recipe('r5')],
    },
  ],
  nutritionAccuracy: 'ESTIMATED',
  generatedAt: new Date().toISOString(),
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/* ---------------- getRecommendationsToday ---------------- */

test('getRecommendationsToday: happy path validates the contract', async () => {
  let capturedUrl = '';
  let capturedBody = '';
  const result = await getRecommendationsToday(
    { budgetMode: 'MINIMAL', maxMinutes: 20, antiFilters: ['SHORT_TIME'] },
    {
      baseUrl: 'http://api.test',
      fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedBody = String(init?.body ?? '');
        void capturedBody;
        return jsonResponse(200, { data: validRecommendation });
      },
    } as never,
  );
  assert.equal(result.error, undefined);
  assert.ok(result.data);
  assert.equal(result.data?.options.length, 3);
  assert.match(capturedUrl, /\/api\/v1\/recommendations\/today$/);
  assert.match(capturedBody, /"generationSettings"/);
});

test('getRecommendationsToday: contract mismatch → CONTRACT_MISMATCH error', async () => {
  const broken = { ...validRecommendation, options: [] }; // schema requires length 3
  const result = await getRecommendationsToday({}, {
    baseUrl: 'http://api.test',
    fetchImpl: (async () => jsonResponse(200, { data: broken })) as never,
  } as never);
  assert.equal(result.data, undefined);
  assert.equal(result.error?.error.code, 'CONTRACT_MISMATCH');
});

test('getRecommendationsToday: HTTP error passes through', async () => {
  const result = await getRecommendationsToday({}, {
    baseUrl: 'http://api.test',
    fetchImpl: (async () =>
      jsonResponse(500, {
        error: { code: 'INTERNAL_ERROR', message: 'boom' },
      })) as never,
  } as never);
  assert.equal(result.error?.error.code, 'INTERNAL_ERROR');
});

/* ---------------- acceptRecommendation mock ---------------- */

test('usesMealPlanMock: only the exact string "1" enables the mock', () => {
  const original = process.env['NEXT_PUBLIC_USE_MEALPLAN_MOCK'];
  try {
    process.env['NEXT_PUBLIC_USE_MEALPLAN_MOCK'] = '1';
    assert.equal(usesMealPlanMock(), true);
    process.env['NEXT_PUBLIC_USE_MEALPLAN_MOCK'] = '0';
    assert.equal(usesMealPlanMock(), false);
    delete process.env['NEXT_PUBLIC_USE_MEALPLAN_MOCK'];
    assert.equal(usesMealPlanMock(), false);
  } finally {
    if (original !== undefined) process.env['NEXT_PUBLIC_USE_MEALPLAN_MOCK'] = original;
  }
});

test('acceptRecommendation mock: returns prefixed ids without fetch', async () => {
  const original = process.env['NEXT_PUBLIC_USE_MEALPLAN_MOCK'];
  process.env['NEXT_PUBLIC_USE_MEALPLAN_MOCK'] = '1';
  try {
    let fetchCalled = 0;
    const g = globalThis as unknown as Record<string, unknown>;
    const origFetch = g['fetch'];
    g['fetch'] = () => {
      fetchCalled += 1;
      return Promise.reject(new Error('no network'));
    };
    try {
      const result = await acceptRecommendation({ recipeId: 'r1', servings: 2 });
      assert.equal(result.error, undefined);
      assert.match(result.data?.mealPlanId ?? '', /^mock-plan-/);
      assert.match(result.data?.shoppingListId ?? '', /^mock-list-/);
      assert.equal(fetchCalled, 0, 'mock must not touch the network');
    } finally {
      g['fetch'] = origFetch;
    }
  } finally {
    if (original !== undefined) process.env['NEXT_PUBLIC_USE_MEALPLAN_MOCK'] = original;
  }
});

test('acceptRecommendation real mode: posts to /meal-plans and validates', async () => {
  const original = process.env['NEXT_PUBLIC_USE_MEALPLAN_MOCK'];
  delete process.env['NEXT_PUBLIC_USE_MEALPLAN_MOCK'];
  try {
    let capturedBody = '';
    const result = await acceptRecommendation({ recipeId: 'r1', servings: 2 }, {
      baseUrl: 'http://api.test',
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        capturedBody = String(init?.body ?? '');
        void url;
        return jsonResponse(200, {
          data: { mealPlanId: 'plan-1', shoppingListId: 'list-1' },
        });
      }) as never,
    } as never);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.data, { mealPlanId: 'plan-1', shoppingListId: 'list-1' });
    assert.match(capturedBody, /"recipeId":"r1"/);
  } finally {
    if (original !== undefined) process.env['NEXT_PUBLIC_USE_MEALPLAN_MOCK'] = original;
  }
});

test('acceptRecommendation real mode: malformed body → CONTRACT_MISMATCH', async () => {
  const original = process.env['NEXT_PUBLIC_USE_MEALPLAN_MOCK'];
  delete process.env['NEXT_PUBLIC_USE_MEALPLAN_MOCK'];
  try {
    const result = await acceptRecommendation({ recipeId: 'r1', servings: 2 }, {
      baseUrl: 'http://api.test',
      fetchImpl: (async () => jsonResponse(200, { data: { mealPlanId: 'plan-1' } })) as never, // missing shoppingListId
    } as never);
    assert.equal(result.error?.error.code, 'CONTRACT_MISMATCH');
  } finally {
    if (original !== undefined) process.env['NEXT_PUBLIC_USE_MEALPLAN_MOCK'] = original;
  }
});
