// T46-A/T46-C (E23): error-message localization. The dictionary lives in
// contracts; the exception filter resolves the human message by
// User.locale (default 'ru'). Compile-time exhaustiveness is enforced in
// error-envelope.ts; these tests pin the runtime contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_MESSAGES } from '@multichef/contracts';
import { localizeErrorMessage, STATUS_BY_CODE } from '../common/error-envelope.js';

test('dictionary covers every STATUS_BY_CODE key (runtime mirror)', () => {
  for (const code of Object.keys(STATUS_BY_CODE)) {
    const entry = (ERROR_MESSAGES as Record<string, { ru: string; en: string }>)[code];
    assert.ok(entry, `missing dictionary entry for ${code}`);
    assert.ok(entry.ru.length > 0, `${code}.ru empty`);
    assert.ok(entry.en.length > 0, `${code}.en empty`);
  }
});

test('localizeErrorMessage: ru default, en explicit, fallback for unknown code', () => {
  assert.equal(
    localizeErrorMessage('PANTRY_ITEM_NOT_FOUND', undefined, 'fallback'),
    'Продукт не найден в холодильнике',
  );
  assert.equal(
    localizeErrorMessage('PANTRY_ITEM_NOT_FOUND', 'ru', 'fallback'),
    'Продукт не найден в холодильнике',
  );
  assert.equal(
    localizeErrorMessage('PANTRY_ITEM_NOT_FOUND', 'en', 'fallback'),
    'Pantry item not found',
  );
  assert.equal(
    localizeErrorMessage('TOTALLY_DYNAMIC_CODE', 'en', 'Dynamic detail'),
    'Dynamic detail',
  );
  assert.equal(
    localizeErrorMessage(undefined, 'ru', 'Internal server error'),
    'Internal server error',
  );
});

test('previously-EN throws now come out in ru via the dictionary', () => {
  // pantry.service.ts used to throw English 'Ingredient not found' (T46-A).
  assert.equal(
    localizeErrorMessage('INGREDIENT_NOT_FOUND', 'ru', 'Ingredient not found'),
    'Ингредиент не найден',
  );
});
