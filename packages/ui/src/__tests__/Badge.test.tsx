import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from './_dom.tsx';
import './_dom.tsx';
const { Badge } = await import('../components/Badge');

test('Badge renders text content', () => {
  const { container } = render(<Badge>5 мин</Badge>);
  assert.equal(container.textContent, '5 мин');
});

test('Badge tone=fresh maps to fresh surface class', () => {
  const { container } = render(<Badge tone="fresh">свежее</Badge>);
  const badge = container.querySelector('span');
  assert.match(badge?.className ?? '', /bg-\[var\(--color-fresh-soft\)\]/);
});

test('Badge tone=danger maps to danger surface class', () => {
  const { container } = render(<Badge tone="danger">истёк</Badge>);
  const badge = container.querySelector('span');
  assert.match(badge?.className ?? '', /bg-\[var\(--color-danger-soft\)\]/);
});

test('Badge is non-interactive (no button role)', () => {
  const { container } = render(<Badge>static</Badge>);
  assert.equal(container.querySelectorAll('button').length, 0);
});
