// Roulette UI tests (MC-042): attempt labels and the pure RouletteCard
// render states (closed / flipped / fate-locked). Router + fetch live
// in RouletteClient (untested here — MC-034 precedent).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { attemptsLabel, RouletteCard } from '../RouletteClient';
import type { RouletteDrawResponseDto } from '@multichef/contracts';

const recipe = (id: string, title: string) => ({
  id,
  title,
  description: null,
  imageKey: null,
  servings: 2,
  prepMinutes: 10,
  cookMinutes: 20,
  difficulty: 1,
  mealTypes: ['LUNCH' as const],
  tags: [] as string[],
  requiredAppliances: [] as string[],
});

const drawn: RouletteDrawResponseDto = {
  option: {
    type: 'BEST_MATCH',
    recipe: recipe('r9', 'Паста с чесноком'),
    score: 0.81,
    explanation: 'быстро готовить',
  },
  attemptsLeft: 2,
};

test('attemptsLabel: 2 → «Осталось 2 попытки», 1 → «Осталась 1 попытка», 0 → нет', () => {
  assert.equal(attemptsLabel(2), 'Осталось 2 попытки');
  assert.equal(attemptsLabel(1), 'Осталась 1 попытка');
  assert.equal(attemptsLabel(0), 'Попыток не осталось');
});

test('RouletteCard closed: dish hidden, «Другое» available, attempts shown', () => {
  const html = renderToString(
    React.createElement(RouletteCard, {
      drawn,
      flipped: false,
      acceptBusy: false,
      fateLocked: false,
      onFlip: () => {},
      onAccept: () => {},
      onAnother: () => {},
    }),
  );
  assert.ok(html.includes('roulette-card-closed'), 'closed card rendered');
  assert.ok(!html.includes('Паста с чесноком'), 'dish title hidden before flip');
  assert.ok(/Осталось 2 попытки/.test(html.replace(/<!--.*?-->/g, '')));
  assert.match(html, /disabled=""/, 'Беру! disabled until flipped');
});

test('RouletteCard flipped: dish visible, «Беру!» active', () => {
  const html = renderToString(
    React.createElement(RouletteCard, {
      drawn,
      flipped: true,
      acceptBusy: false,
      fateLocked: false,
      onFlip: () => {},
      onAccept: () => {},
      onAnother: () => {},
    }),
  );
  assert.match(html, /Паста с чесноком/);
  assert.match(html, /Беру!/);
  assert.match(html, /data-testid="roulette-accept"/);
});

test('RouletteCard fate-locked: «Другое» disabled, «Судьба выбрана»', () => {
  const html = renderToString(
    React.createElement(RouletteCard, {
      drawn: { ...drawn, attemptsLeft: 0 },
      flipped: true,
      acceptBusy: false,
      fateLocked: true,
      onFlip: () => {},
      onAccept: () => {},
      onAnother: () => {},
    }),
  );
  assert.match(html, /Судьба выбрана/);
  const another = html.match(/<button[^>]*data-testid="roulette-another"[^>]*>/);
  assert.ok(another, 'Другое button rendered');
  assert.match(another[0], /disabled/);
});
