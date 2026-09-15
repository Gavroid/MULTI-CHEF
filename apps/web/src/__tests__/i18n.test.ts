// T46-B/C/D (E23): i18n foundation unit tests — dictionary shape,
// timezone-aware helpers. Coverage (keys <-> usages) is gated separately
// by scripts/check-i18n-coverage.mjs (pnpm check:i18n).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import ru from '../i18n/ru';
import { formatDateInTz, todayInTz } from '../lib/datetime';
import { formatExpiry } from '../lib/expiry';

test('ru dictionary: nav + profile namespaces are non-empty', () => {
  for (const key of ['today', 'fridge', 'plan', 'shopping', 'profile', 'ariaLabel'] as const) {
    assert.ok((ru.nav[key] as string).length > 0, `nav.${key} empty`);
  }
  assert.equal(ru.profile.title, 'Профиль');
  assert.equal(ru.profile.login, 'Войти');
  assert.equal(ru.profile.timezone, 'Часовой пояс');
});

test('todayInTz: late-UTC evening is already tomorrow in Moscow', () => {
  const now = new Date('2026-03-19T21:00:00Z'); // 00:00 Mar 20 in MSK
  assert.equal(todayInTz('Europe/Moscow', now), '2026-03-20');
  assert.equal(todayInTz('UTC', now), '2026-03-19');
  assert.equal(todayInTz(undefined, now), '2026-03-20'); // default tz
});

test('formatDateInTz: locale switches the rendering of the same instant', () => {
  const d = new Date('2026-09-16T12:00:00Z');
  const ru2 = formatDateInTz(d, 'ru', 'UTC');
  const en = formatDateInTz(d, 'en', 'UTC');
  assert.notEqual(ru2, en);
  assert.match(ru2, /сентября/);
  assert.match(en, /September/);
});

test('formatExpiry defaults to the product tz (Europe/Moscow)', () => {
  const now = new Date('2026-03-19T21:00:00Z');
  const def = formatExpiry('2026-03-20', now);
  const msk = formatExpiry('2026-03-20', now, 'Europe/Moscow');
  assert.deepEqual(def, msk);
});
