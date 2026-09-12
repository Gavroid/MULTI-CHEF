// Component tests for the /today idle-view components (MC-034):
// Greeting, UrgentBlock, QuickScenarios. Mostly pure-render — covered
// with renderToString; link contracts asserted from the markup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { Greeting, greetingForHour } from '../components/Greeting';
import { UrgentBlock, selectUrgentItems } from '../components/UrgentBlock';
import { QuickScenarios, QUICK_SCENARIOS } from '../components/QuickScenarios';
import { HeroButton } from '../components/HeroButton';
import { BudgetProgress, formatKopecks } from '../components/BudgetProgress';
import { UpcomingMeals } from '../components/UpcomingMeals';

/* ---------------- Greeting ---------------- */

test('greetingForHour: morning / day / evening buckets', () => {
  assert.equal(greetingForHour(7).text, 'Доброе утро');
  assert.equal(greetingForHour(11).text, 'Доброе утро');
  assert.equal(greetingForHour(12).text, 'Добрый день');
  assert.equal(greetingForHour(17).text, 'Добрый день');
  assert.equal(greetingForHour(18).text, 'Добрый вечер');
  assert.equal(greetingForHour(23).text, 'Добрый вечер');
});

test('Greeting renders the right text for the injected hour', () => {
  const html = renderToString(
    React.createElement(Greeting, { now: new Date('2026-01-01T09:00:00') }),
  );
  assert.match(html, /Доброе утро/);
  const evening = renderToString(
    React.createElement(Greeting, { now: new Date('2026-01-01T21:00:00') }),
  );
  assert.match(evening, /Добрый вечер/);
});

/* ---------------- UrgentBlock ---------------- */

const PANTRY = [
  { id: 'a', name: 'Молоко', expiresAt: '2026-03-05' },
  { id: 'b', name: 'Йогурт', expiresAt: '2026-03-03' },
  { id: 'c', name: 'Сметана', expiresAt: '2026-03-08' },
  { id: 'd', name: 'Творог', expiresAt: null },
  { id: 'e', name: 'Кефир', expiresAt: '2026-03-04' },
];

test('selectUrgentItems: ≤ today+3d, soonest first, max 3, null expiry skipped', () => {
  const now = new Date('2026-03-05T12:00:00');
  const urgent = selectUrgentItems(PANTRY, now);
  assert.deepEqual(
    urgent.map((i) => i.id),
    ['b', 'e', 'a'],
    'b(03) e(04) a(05) urgent; c(08) outside window; d null skipped',
  );
});

test('selectUrgentItems: empty when nothing in the window', () => {
  const now = new Date('2026-03-01T12:00:00');
  assert.deepEqual(selectUrgentItems(PANTRY, now), []);
});

test('UrgentBlock: renders items; hidden when nothing urgent', () => {
  const now = new Date('2026-03-05T12:00:00');
  const html = renderToString(React.createElement(UrgentBlock, { items: PANTRY, now }));
  assert.match(html, /Срочно использовать/);
  assert.match(html, /Йогурт/);
  assert.ok(!html.includes('Сметана'), 'outside-window item hidden');

  const empty = renderToString(
    React.createElement(UrgentBlock, { items: PANTRY, now: new Date('2026-03-01T12:00:00') }),
  );
  assert.equal(empty, '', 'no urgent items → component renders nothing');
});

/* ---------------- QuickScenarios ---------------- */

test('QuickScenarios: 4 chips with the documented prefill hrefs', () => {
  const html = renderToString(React.createElement(QuickScenarios));
  assert.match(html, /\/today\/generate\?prefill=NOTHING/);
  assert.match(html, /\/today\/generate\?prefill=\.30\./);
  assert.match(html, /\/today\/generate\?prefill=\.\.NO_OVEN/);
  assert.match(html, /\/today\/generate\?prefill=URGENT/);
  assert.equal(QUICK_SCENARIOS.length, 4);
});

/* ---------------- HeroButton ---------------- */

test('HeroButton: CTA with pantry; empty-pantry variant without', () => {
  const cta = renderToString(React.createElement(HeroButton, { pantrySize: 5 }));
  assert.match(cta, /Получить рекомендацию/);
  assert.match(cta, /data-testid="hero-cta"/);

  const empty = renderToString(React.createElement(HeroButton, { pantrySize: 0 }));
  assert.match(empty, /Добавьте продукты в холодильник/);
  assert.ok(!empty.includes('hero-cta'));
});

/* ---------------- BudgetProgress ---------------- */

test('formatKopecks: roubles with ru-RU grouping', () => {
  assert.equal(formatKopecks(0), '₽0');
  assert.equal(formatKopecks(24000), '₽240');
});

test('BudgetProgress: hidden without budget; ratio rendered with budget', () => {
  const hidden = renderToString(React.createElement(BudgetProgress, { budgetWeekKopecks: null }));
  assert.equal(hidden, '');

  const shown = renderToString(
    React.createElement(BudgetProgress, { budgetWeekKopecks: 200000, spentKopecks: 50000 }),
  );
  assert.match(shown, /25%/);
  assert.match(shown, /Бюджет на неделю/);
});

/* ---------------- UpcomingMeals ---------------- */

test('UpcomingMeals: hidden without plan; 3 nearest sorted when present', () => {
  const hidden = renderToString(React.createElement(UpcomingMeals, { activePlan: null }));
  assert.equal(hidden, '');

  const plan = {
    entries: [
      { recipeId: 'r3', title: 'Ужин', scheduledFor: '2026-03-06' },
      { recipeId: 'r1', title: 'Завтрак', scheduledFor: '2026-03-04' },
      { recipeId: 'r2', title: 'Обед', scheduledFor: '2026-03-05' },
      { recipeId: 'r4', title: 'Позже', scheduledFor: '2026-03-09' },
    ],
  };
  const html = renderToString(React.createElement(UpcomingMeals, { activePlan: plan }));
  assert.match(html, /Завтрак/);
  const breakfastIdx = html.indexOf('Завтрак');
  const lunchIdx = html.indexOf('Обед');
  const dinnerIdx = html.indexOf('Ужин');
  assert.ok(breakfastIdx < lunchIdx && lunchIdx < dinnerIdx, 'sorted by date');
  assert.ok(!html.includes('Позже'), 'only 3 nearest shown');
});
