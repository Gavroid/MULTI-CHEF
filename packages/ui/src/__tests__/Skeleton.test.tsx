import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from './_dom.tsx';
import './_dom.tsx';
const { Skeleton } = await import('../components/Skeleton');

test('Skeleton renders an element with role=status', () => {
  const { container } = render(<Skeleton />);
  const el = container.querySelector('[role="status"]');
  assert.ok(el);
  assert.equal(el?.getAttribute('aria-label'), 'Loading');
});

test('Skeleton rounded=true renders circle (rounded-full)', () => {
  const { container } = render(<Skeleton rounded width="w-12" height="h-12" />);
  const el = container.querySelector('[role="status"]');
  assert.match(el?.className ?? '', /rounded-full/);
});

test('Skeleton default is rounded-sm (not circle)', () => {
  const { container } = render(<Skeleton />);
  const el = container.querySelector('[role="status"]');
  assert.match(el?.className ?? '', /rounded-\[var\(--radius-sm\)\]/);
  assert.doesNotMatch(el?.className ?? '', /rounded-full/);
});
