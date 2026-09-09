import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from './_dom.tsx';
import './_dom.tsx';
const { Card } = await import('../components/Card');

test('Card renders children', () => {
  const { container } = render(<Card>содержимое</Card>);
  const card = container.querySelector('div');
  assert.ok(card);
  assert.equal(card?.textContent, 'содержимое');
});

test('Card default variant uses surface + border classes', () => {
  const { container } = render(<Card>data</Card>);
  const card = container.querySelector('div');
  assert.match(card?.className ?? '', /bg-\[var\(--color-surface\)\]/);
  assert.match(card?.className ?? '', /border/);
  assert.doesNotMatch(card?.className ?? '', /shadow/);
});

test('Card elevated variant uses shadow class', () => {
  const { container } = render(<Card variant="elevated">data</Card>);
  const card = container.querySelector('div');
  assert.match(card?.className ?? '', /shadow-\[var\(--shadow-card\)\]/);
});

test('Card as="article" renders the right tag', () => {
  const { container } = render(<Card as="article">item</Card>);
  assert.equal(container.querySelector('article')?.textContent, 'item');
});
