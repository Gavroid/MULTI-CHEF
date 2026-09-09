import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, fireClick, getByRole } from './_dom.tsx';
import './_dom.tsx';
const { Chip } = await import('../components/Chip');

test('Chip renders label and is a real <button>', () => {
  const { container } = render(<Chip>Острое</Chip>);
  const chip = getByRole(container, 'button', { name: 'Острое' });
  assert.equal(chip.tagName, 'BUTTON');
  assert.equal(chip.getAttribute('aria-pressed'), 'false');
});

test('Chip selected=true reflects in aria-pressed and class', () => {
  const { container } = render(<Chip selected>Веган</Chip>);
  const chip = getByRole(container, 'button', { name: /Веган/ });
  assert.equal(chip.getAttribute('aria-pressed'), 'true');
  assert.match(chip.className, /bg-\[var\(--color-primary-soft\)\]/);
  assert.match(chip.className, /border-\[var\(--color-primary\)\]/);
});

test('Chip click toggles selection via parent state (handler fires)', () => {
  let selected = false;
  const { container } = render(
    <Chip
      selected={selected}
      onClick={() => {
        selected = !selected;
      }}
    >
      Без лактозы
    </Chip>,
  );
  const chip = getByRole(container, 'button', { name: 'Без лактозы' });
  fireClick(chip);
  assert.equal(selected, true);
});

test('Chip has min-h-10 (PRD §2.5.4)', () => {
  const { container } = render(<Chip>size</Chip>);
  const chip = getByRole(container, 'button', { name: 'size' });
  assert.match(chip.className, /min-h-10/);
});
