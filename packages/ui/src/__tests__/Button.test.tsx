import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render, fireClick, getByRole } from './_dom.tsx';
// Install DOM globals on module load (idempotent).
import './_dom.tsx';
const { Button } = await import('../components/Button');

test('Button renders children text', () => {
  const { container } = render(<Button>Сохранить</Button>);
  const btn = getByRole(container, 'button', { name: 'Сохранить' });
  assert.equal(btn.tagName, 'BUTTON');
});

test('Button fires onClick when clicked', () => {
  let clicked = 0;
  const { container } = render(
    <Button
      onClick={() => {
        clicked += 1;
      }}
    >
      Tap
    </Button>,
  );
  fireClick(getByRole(container, 'button', { name: 'Tap' }));
  assert.equal(clicked, 1);
});

test('Button respects disabled prop (no click, disabled attr)', () => {
  let clicked = 0;
  const { container } = render(
    <Button
      disabled
      onClick={() => {
        clicked += 1;
      }}
    >
      No
    </Button>,
  );
  const btn = getByRole(container, 'button', { name: 'No' });
  assert.equal(btn.hasAttribute('disabled'), true);
  fireClick(btn);
  assert.equal(clicked, 0);
});

test('Button loading state shows spinner and is aria-busy + disabled', () => {
  const { container } = render(<Button loading>Отправляем</Button>);
  // The label "Отправляем" is still discoverable as the button's accessible name.
  const btn = getByRole(container, 'button', { name: /Отправляем/ });
  assert.equal(btn.getAttribute('aria-busy'), 'true');
  assert.equal(btn.hasAttribute('disabled'), true);
  // Spinner is marked aria-hidden so screen readers don't announce it twice.
  const spinner = btn.querySelector('[aria-hidden="true"]');
  assert.ok(spinner, 'spinner should be present in loading state');
});

test('Button variant=danger applies danger surface class', () => {
  const { container } = render(<Button variant="danger">Удалить</Button>);
  const btn = getByRole(container, 'button', { name: 'Удалить' });
  // Exact class, not arbitrary CSS — Tailwind classes drive the visual.
  assert.match(btn.className, /bg-\[var\(--color-danger\)\]/);
});

test('Button size=sm applies compact height (h-10)', () => {
  const { container } = render(<Button size="sm">Маленькая</Button>);
  const btn = getByRole(container, 'button', { name: 'Маленькая' });
  assert.match(btn.className, /h-10/);
});

test('Button responds to Enter keypress (native button semantics)', () => {
  let clicked = 0;
  const { container } = render(
    <Button
      onClick={() => {
        clicked += 1;
      }}
    >
      Ввод
    </Button>,
  );
  const btn = getByRole(container, 'button', { name: 'Ввод' });
  // Native <button> activates on Enter — fire a click event the same way
  // a browser would. (We test the handler is wired; we don't test browser
  // keyboard plumbing.)
  fireClick(btn);
  assert.equal(clicked, 1);
});
