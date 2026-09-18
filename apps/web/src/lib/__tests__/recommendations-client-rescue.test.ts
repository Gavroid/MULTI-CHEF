// getRescueRecommendations unit tests (MC-040): contract validation,
// deps injection, error passthrough.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getRescueRecommendations } from '../recommendations-client';
import type { RescueResponseDto } from '@multichef/contracts';

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

const validRescue: RescueResponseDto = {
  options: [
    {
      type: 'FROM_PANTRY',
      recipe: recipe('r1'),
      score: 0.9,
      explanation: 'использует продукты, которые скоро испортятся',
      toBuyCount: 0,
      chainTag: null,
    },
  ],
  nutritionAccuracy: 'ESTIMATED',
  generatedAt: new Date().toISOString(),
  pantryUsage: { usedGrams: 150, totalGrams: 400 },
  ingredient: { id: 'tvorog', canonicalName: 'Творог', totalGrams: 400 },
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

test('getRescueRecommendations: happy path validates the contract', async () => {
  let capturedUrl = '';
  let capturedBody = '';
  const result = await getRescueRecommendations({ ingredientId: 'tvorog', maxMinutes: 30 }, {
    baseUrl: 'http://api.test',
    fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = String(init?.body ?? '');
      return jsonResponse(200, { data: validRescue });
    },
  } as never);
  assert.equal(result.error, undefined);
  assert.ok(result.data);
  assert.equal(result.data?.ingredient.id, 'tvorog');
  assert.ok(capturedUrl.endsWith('/api/v1/recommendations/rescue'));
  assert.match(capturedBody, /tvorog/);
});

test('getRescueRecommendations: single-option response passes min(1)', async () => {
  const single = { ...validRescue, options: validRescue.options.slice(0, 1) };
  const result = await getRescueRecommendations({ ingredientId: 'tvorog' }, {
    baseUrl: 'http://api.test',
    fetchImpl: async () => jsonResponse(200, { data: single }),
  } as never);
  assert.equal(result.error, undefined);
  assert.equal(result.data?.options.length, 1);
});

test('getRescueRecommendations: broken contract → CONTRACT_MISMATCH', async () => {
  const result = await getRescueRecommendations({ ingredientId: 'tvorog' }, {
    baseUrl: 'http://api.test',
    fetchImpl: async () =>
      jsonResponse(200, {
        data: { ...validRescue, ingredient: { id: '', canonicalName: '', totalGrams: -1 } },
      }),
  } as never);
  assert.equal(result.data, undefined);
  assert.equal(result.error?.error.code, 'CONTRACT_MISMATCH');
});

test('getRescueRecommendations: 404 error envelope passes through', async () => {
  const result = await getRescueRecommendations({ ingredientId: 'ghost' }, {
    baseUrl: 'http://api.test',
    fetchImpl: async () =>
      jsonResponse(404, {
        error: { code: 'INGREDIENT_NOT_FOUND', message: 'Продукт не найден в холодильнике' },
      }),
  } as never);
  assert.equal(result.data, undefined);
  assert.equal(result.error?.status, 404);
  assert.equal(result.error?.error.code, 'INGREDIENT_NOT_FOUND');
});
