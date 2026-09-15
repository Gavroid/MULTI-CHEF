// expiry — pure helpers for human date labels + list partitioning.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatExpiry,
  comparePantryItems,
  partitionByExpiry,
  type ExpiryLabel,
} from '../lib/expiry';
import type { PantryItem } from '../lib/pantry-client';

const NOW = new Date('2026-03-15T12:00:00Z');

function makeItem(overrides: Partial<PantryItem> = {}): PantryItem {
  return {
    id: '01HXXXXXXXXXXXXXXXXXXXXXXXX',
    householdId: '01HYYYYYYYYYYYYYYYYYYYYYY',
    ingredientId: '01HZZZZZZZZZZZZZZZZZZZZZZ',
    quantity: 100,
    unit: 'G',
    estimatedGrams: 100,
    amountStatus: 'SOME',
    priority: 'NORMAL',
    storageLocation: 'FRIDGE',
    opened: false,
    expiresAt: null,
    purchaseDate: null,
    archivedAt: null,
    notes: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

test('formatExpiry returns muted "Нет срока" for null', () => {
  const label = formatExpiry(null, NOW);
  assert.equal(label.text, 'Нет срока');
  assert.equal(label.tone, 'muted');
  assert.equal(label.daysRemaining, null);
});

test('formatExpiry returns muted "Нет срока" for malformed input', () => {
  assert.equal(formatExpiry('not-a-date', NOW).text, 'Нет срока');
  assert.equal(formatExpiry('2026-13-40', NOW).text, 'Нет срока');
  assert.equal(formatExpiry('', NOW).text, 'Нет срока');
});

test('formatExpiry shows "До <day> <month>" for the future (warning ≤3 days, neutral after)', () => {
  // 36 days out → neutral tone → short month form.
  const label = formatExpiry('2026-04-20', NOW);
  assert.match(label.text, /^До 20 апр$/);
  assert.equal(label.tone, 'neutral');
  assert.equal(label.daysRemaining, 36);
});

test('formatExpiry collapses to short month for far future', () => {
  // 2026-12-31 = 291 days away → short format "До 31 дек".
  const label = formatExpiry('2026-12-31', NOW);
  assert.match(label.text, /^До 31 дек$/);
});

test('formatExpiry marks "До <day> <month>" with warning tone for ≤ 3 days', () => {
  const label = formatExpiry('2026-03-17', NOW); // 2 days
  assert.equal(label.tone, 'warning');
  assert.match(label.text, /^До 17 марта$/);
});
test('formatExpiry shows warning for same day (today)', () => {
  const label = formatExpiry('2026-03-15', NOW);
  assert.equal(label.tone, 'warning');
  assert.equal(label.text, 'Годен до сегодня');
  assert.equal(label.daysRemaining, 0);
});

test('formatExpiry shows "Истёк X дней назад" with danger tone for past', () => {
  const label = formatExpiry('2026-03-10', NOW); // 5 days ago
  assert.equal(label.tone, 'danger');
  assert.equal(label.text, 'Истёк 5 дней назад');
  assert.equal(label.daysRemaining, -5);
});

test('formatExpiry uses Russian pluralisation for days (1, 2-4, 5-20, 21+)', () => {
  assert.equal(formatExpiry('2026-03-14', NOW).text, 'Истёк 1 день назад');
  assert.equal(formatExpiry('2026-03-13', NOW).text, 'Истёк 2 дня назад');
  assert.equal(formatExpiry('2026-03-12', NOW).text, 'Истёк 3 дня назад');
  assert.equal(formatExpiry('2026-03-10', NOW).text, 'Истёк 5 дней назад');
  assert.equal(formatExpiry('2026-02-22', NOW).text, 'Истёк 21 день назад');
});

test('comparePantryItems sorts by expiresAt asc (closest first)', () => {
  const a = makeItem({ id: 'a', expiresAt: '2026-03-10' }); // expired
  const b = makeItem({ id: 'b', expiresAt: '2026-03-20' });
  const c = makeItem({ id: 'c', expiresAt: '2026-04-01' });
  const sorted = [c, a, b].sort(comparePantryItems);
  assert.deepEqual(
    sorted.map((x) => x.id),
    ['a', 'b', 'c'],
  );
});

test('comparePantryItems puts items without expiresAt after dated ones', () => {
  const dated = makeItem({ id: 'dated', expiresAt: '2026-04-01' });
  const noDate = makeItem({ id: 'nodate', expiresAt: null });
  const sorted = [noDate, dated].sort(comparePantryItems);
  assert.equal(sorted[0]?.id, 'dated');
  assert.equal(sorted[1]?.id, 'nodate');
});

test('comparePantryItems uses createdAt desc as tiebreaker', () => {
  const older = makeItem({ id: 'older', expiresAt: null, createdAt: '2026-01-01T00:00:00.000Z' });
  const newer = makeItem({ id: 'newer', expiresAt: null, createdAt: '2026-02-01T00:00:00.000Z' });
  const sorted = [older, newer].sort(comparePantryItems);
  assert.equal(sorted[0]?.id, 'newer');
});

test('partitionByExpiry splits at 7 days', () => {
  const expired = makeItem({ id: 'exp', expiresAt: '2026-03-10' });
  const today = makeItem({ id: 'tod', expiresAt: '2026-03-15' });
  const in3d = makeItem({ id: 'in3', expiresAt: '2026-03-18' });
  const in7d = makeItem({ id: 'in7', expiresAt: '2026-03-22' });
  const in30d = makeItem({ id: 'in30', expiresAt: '2026-04-14' });
  const noDate = makeItem({ id: 'nodt', expiresAt: null });

  const { expiring, fresh } = partitionByExpiry([in30d, noDate, expired, today, in7d, in3d], NOW);
  assert.deepEqual(
    expiring.map((i) => i.id),
    ['exp', 'tod', 'in3', 'in7'],
  );
  assert.deepEqual(
    fresh.map((i) => i.id),
    ['in30', 'nodt'],
  );
});

test('formatExpiry is stable within one user-day (UTC normalisation)', () => {
  // T46-D: "today" is the user's local calendar day (tz param). Two
  // instants inside the SAME Moscow day give the same label.
  const before = new Date('2026-03-15T00:00:00Z'); // 03:00 MSK
  const after = new Date('2026-03-15T20:00:00Z'); // 23:00 MSK, still Mar 15
  const a = formatExpiry('2026-04-01', before);
  const b = formatExpiry('2026-04-01', after);
  assert.deepEqual<ExpiryLabel>(a, b);
});

test('formatExpiry rolls "today" over at the user local midnight (T46-D)', () => {
  // 21:00 UTC on Mar 15 is already Mar 16 in Moscow → one day less left.
  const now = new Date('2026-03-19T21:00:00Z');
  const utcView = formatExpiry('2026-03-20', now, 'UTC');
  const mskView = formatExpiry('2026-03-20', now, 'Europe/Moscow');
  assert.equal(utcView.daysRemaining, 1);
  assert.equal(mskView.daysRemaining, 0);
  assert.equal(mskView.text, 'Годен до сегодня');
});
