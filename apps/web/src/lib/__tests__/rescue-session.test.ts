// rescue-session unit tests (MC-040): save/load round-trip, TTL expiry,
// corrupt entries, null ref.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadRescueSession, RESCUE_TTL_MS, saveRescueSession } from '../rescue-session';
import type { RescueResponseDto } from '@multichef/contracts';

function stubStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getLength: () => map.size,
    key: () => null,
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  } as unknown as Storage;
}

const result: RescueResponseDto = {
  options: [
    {
      type: 'FROM_PANTRY',
      recipe: {
        id: 'r1',
        title: 'Оладьи из кабачков',
        description: null,
        imageKey: null,
        servings: 2,
        prepMinutes: 10,
        cookMinutes: 20,
        difficulty: 1,
        mealTypes: ['LUNCH'],
        tags: [],
        requiredAppliances: [],
      },
      score: 0.9,
      explanation: 'использует продукты, которые скоро испортятся',
      toBuyCount: 1,
      chainTag: null,
    },
  ],
  nutritionAccuracy: 'ESTIMATED',
  generatedAt: new Date().toISOString(),
  pantryUsage: { usedGrams: 300, totalGrams: 500 },
  ingredient: { id: 'kabachok', canonicalName: 'Кабачок', totalGrams: 500 },
};

test('save/load round-trip preserves the rescue result', () => {
  const storage = stubStorage();
  const ref = saveRescueSession(result, storage);
  const loaded = loadRescueSession(ref, storage);
  assert.ok(loaded);
  assert.equal(loaded?.result.ingredient.canonicalName, 'Кабачок');
  assert.equal(loaded?.result.pantryUsage.usedGrams, 300);
});

test('loadRescueSession: null/unknown ref → null', () => {
  const storage = stubStorage();
  assert.equal(loadRescueSession(null, storage), null);
  assert.equal(loadRescueSession('missing', storage), null);
});

test('loadRescueSession: expired entry → null and removed', () => {
  const storage = stubStorage();
  storage.setItem(
    'mc-rescue-old',
    JSON.stringify({ result, createdAt: Date.now() - RESCUE_TTL_MS - 1 }),
  );
  assert.equal(loadRescueSession('old', storage), null);
  assert.equal(storage.getItem('mc-rescue-old'), null);
});

test('loadRescueSession: corrupt JSON → null', () => {
  const storage = stubStorage();
  storage.setItem('mc-rescue-bad', '{not json');
  assert.equal(loadRescueSession('bad', storage), null);
});
