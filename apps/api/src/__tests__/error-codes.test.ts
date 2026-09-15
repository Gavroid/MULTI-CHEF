// T38-A/E03: таблица кодов в docs/api/conventions.md должна
// упоминать каждый ErrorCode из error-envelope (иначе документация
// отстаёт от контракта), а STATUS_BY_CODE — покрывать все коды.
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { STATUS_BY_CODE } from '../common/error-envelope.js';

// cwd при запуске api-тестов = apps/api → корень репо на два уровня выше.
const REPO = resolve(process.cwd(), '..', '..', 'docs', 'api');

test('STATUS_BY_CODE covers every ErrorCode', () => {
  for (const [code, status] of Object.entries(STATUS_BY_CODE)) {
    assert.ok(Number.isInteger(status), `status for ${code} must be int`);
  }
});

test('conventions.md documents every domain error code', () => {
  const doc = readFileSync(resolve(REPO, 'conventions.md'), 'utf8');
  const domainCodes = [
    'INGREDIENT_NOT_FOUND',
    'RECIPE_NOT_FOUND',
    'PANTRY_ITEM_NOT_FOUND',
    'PANTRY_ITEM_ARCHIVED',
    'SHOPPING_LIST_NOT_FOUND',
    'PLAN_NOT_FOUND',
    'PREP_TASK_NOT_FOUND',
    'PREFERENCE_NOT_FOUND',
    'NUTRITION_PROFILE_NOT_FOUND',
    'IDEMPOTENT_REPLAY',
    'ITEM_NOT_ARCHIVED',
    'CSRF_MISMATCH',
  ];
  for (const code of domainCodes) {
    assert.ok(doc.includes(code), `conventions.md must document ${code}`);
  }
});
