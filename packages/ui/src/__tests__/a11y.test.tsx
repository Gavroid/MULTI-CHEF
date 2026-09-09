// Lightweight a11y assertions. We don't pull axe-core because integrating
// it into the project's `node --test` + happy-dom stack requires extra
// jsdom bridge code. Instead we assert the semantic attributes that matter
// for screen readers and keyboard nav — these are what PRD §2.5 actually
// cares about (real WCAG AA contrast is enforced via CSS, not JS).

import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, fireClick, getByRole } from './_dom.tsx';
import './_dom.tsx';

test('Button: visible focus ring class is present', async () => {
  const { Button } = await import('../components/Button');
  const { container } = render(<Button>X</Button>);
  const btn = getByRole(container, 'button', { name: 'X' });
  assert.match(btn.className, /focus-visible:ring/);
});

test('Button: loading state does not trap focus on hidden content', async () => {
  const { Button } = await import('../components/Button');
  const { container } = render(<Button loading>Загрузка</Button>);
  const btn = getByRole(container, 'button', { name: /Загрузка/ });
  // aria-busy must be on the button itself.
  assert.equal(btn.getAttribute('aria-busy'), 'true');
  // The spinner has aria-hidden so it's skipped by screen readers.
  const spinner = btn.querySelector('[aria-hidden="true"]');
  assert.ok(spinner);
});

test('Input: label is associated with input via htmlFor/id', async () => {
  const { Input } = await import('../components/Input');
  const { container } = render(<Input label="Email" />);
  const input = getByRole(container, 'textbox', { name: 'Email' });
  const label = container.querySelector('label');
  assert.ok(label);
  assert.equal(label?.getAttribute('for'), input.id);
});

test('Input: error sets aria-invalid and role=alert on message', async () => {
  const { Input } = await import('../components/Input');
  const { container } = render(<Input label="X" error="bad" />);
  const input = getByRole(container, 'textbox', { name: 'X' });
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.ok(container.querySelector('[role="alert"]'));
});

test('Chip: selected state exposed via aria-pressed', async () => {
  const { Chip } = await import('../components/Chip');
  const { container } = render(<Chip selected>Острое</Chip>);
  const chip = getByRole(container, 'button', { name: /Острое/ });
  assert.equal(chip.getAttribute('aria-pressed'), 'true');
});

test('Chip: keyboard activation via Enter (click event)', async () => {
  const { Chip } = await import('../components/Chip');
  let clicked = 0;
  const { container } = render(
    <Chip
      onClick={() => {
        clicked += 1;
      }}
    >
      Veg
    </Chip>,
  );
  fireClick(getByRole(container, 'button', { name: 'Veg' }));
  assert.equal(clicked, 1);
});

test('Skeleton: marked with role=status for AT announcement', async () => {
  const { Skeleton } = await import('../components/Skeleton');
  const { container } = render(<Skeleton />);
  assert.ok(container.querySelector('[role="status"]'));
});
