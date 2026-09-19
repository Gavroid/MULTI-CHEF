// recommendations-client unit tests (MC-034): contract validation,
// mock accept flow, env-flag hygiene, deps injection.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { acceptRecommendation, getRecommendationsToday } from '../recommendations-client';
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

/* ---------------- acceptRecommendation (R20 F2, вариант b) ---------------- */

function fakeFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  let call = 0;
  const urls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    const r = responses[Math.min(call, responses.length - 1)]!;
    urls.push(String(url));
    call += 1;
    return jsonResponse(r.status, r.body);
  }) as typeof fetch;
  return { impl, urls };
}

test('acceptRecommendation: POST /meal-plans -> poll job -> active plan id', async () => {
  const { impl } = fakeFetchSequence([
    { status: 202, body: { jobId: 'job-1', deduplicated: false } },
    {
      status: 200,
      body: {
        data: {
          id: 'job-1',
          type: 'GENERATE_PLAN',
          status: 'PROCESSING',
          progress: 10,
          stage: null,
          resultRef: null,
          error: null,
          createdAt: '2026-09-16T00:00:00Z',
          updatedAt: '2026-09-16T00:00:00Z',
        },
      },
    },
    {
      status: 200,
      body: {
        data: {
          id: 'job-1',
          type: 'GENERATE_PLAN',
          status: 'COMPLETED',
          progress: 100,
          stage: null,
          resultRef: 'plan-1',
          error: null,
          createdAt: '2026-09-16T00:00:00Z',
          updatedAt: '2026-09-16T00:01:00Z',
        },
      },
    },
    {
      status: 200,
      body: {
        data: {
          id: 'plan-1',
          householdId: 'h1',
          status: 'ACTIVE',
          startDate: '2026-09-16',
          endDate: '2026-09-22',
          peopleCount: 2,
          days: [],
        },
      },
    },
  ]);
  const result = await acceptRecommendation(
    { recipeId: 'r1', servings: 2 },
    { baseUrl: 'http://api.test', fetchImpl: impl },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.data?.mealPlanId, 'plan-1');
  // R20 (b): shopping list создаётся воркером; клиент навигирует на
  // /shopping и читает активный список там — здесь идентификатор пуст.
  assert.equal(result.data?.shoppingListId, '');
});

test('acceptRecommendation: forwards wizard settings as plan setup (T71-A)', async () => {
  let capturedSetup: unknown;
  const { impl } = fakeFetchSequence([
    { status: 202, body: { jobId: 'job-s', deduplicated: false } },
    {
      status: 200,
      body: {
        data: {
          id: 'job-s',
          type: 'GENERATE_PLAN',
          status: 'COMPLETED',
          progress: 100,
          stage: null,
          resultRef: 'plan-s',
          error: null,
          createdAt: '2026-09-16T00:00:00Z',
          updatedAt: '2026-09-16T00:01:00Z',
        },
      },
    },
    {
      status: 200,
      body: {
        data: {
          id: 'plan-s',
          householdId: 'h1',
          status: 'ACTIVE',
          startDate: '2026-09-16',
          endDate: '2026-09-22',
          peopleCount: 2,
          days: [],
        },
      },
    },
  ]);
  const wrapped = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/meal-plans')) capturedSetup = JSON.parse(String(init?.body ?? '{}'));
    return impl(url, init);
  }) as typeof fetch;
  const result = await acceptRecommendation(
    {
      recipeId: 'r1',
      servings: 2,
      setup: { budgetMode: 'MINIMAL', maxMinutes: 20 },
    },
    { baseUrl: 'http://api.test', fetchImpl: wrapped },
  );
  assert.equal(result.error, undefined);
  assert.deepEqual(capturedSetup, { budgetMode: 'MINIMAL', maxMinutes: 20 });
});

test('acceptRecommendation: FAILED job -> JOB_FAILED error', async () => {
  const { impl } = fakeFetchSequence([
    { status: 202, body: { jobId: 'job-2', deduplicated: false } },
    {
      status: 200,
      body: {
        data: {
          id: 'job-2',
          type: 'GENERATE_PLAN',
          status: 'FAILED',
          progress: 0,
          stage: null,
          resultRef: null,
          error: 'ветер',
          createdAt: '2026-09-16T00:00:00Z',
          updatedAt: '2026-09-16T00:00:05Z',
        },
      },
    },
  ]);
  const result = await acceptRecommendation(
    { recipeId: 'r1', servings: 2 },
    { baseUrl: 'http://api.test', fetchImpl: impl },
  );
  assert.equal(result.error?.error.code, 'JOB_FAILED');
  assert.match(result.error?.error.message ?? '', /ветер/);
});

test('acceptRecommendation: malformed active plan -> CONTRACT_MISMATCH', async () => {
  const { impl } = fakeFetchSequence([
    { status: 202, body: { jobId: 'job-3', deduplicated: false } },
    {
      status: 200,
      body: {
        data: {
          id: 'job-3',
          type: 'GENERATE_PLAN',
          status: 'COMPLETED',
          progress: 100,
          stage: null,
          resultRef: 'plan-1',
          error: null,
          createdAt: '2026-09-16T00:00:00Z',
          updatedAt: '2026-09-16T00:01:00Z',
        },
      },
    },
    { status: 200, body: { data: { broken: true } } },
  ]);
  const result = await acceptRecommendation(
    { recipeId: 'r1', servings: 2 },
    { baseUrl: 'http://api.test', fetchImpl: impl },
  );
  assert.equal(result.error?.error.code, 'CONTRACT_MISMATCH');
});
