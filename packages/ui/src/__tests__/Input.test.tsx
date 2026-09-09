import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, getByRole } from './_dom.tsx';
import './_dom.tsx';
const { Input } = await import('../components/Input');

test('Input renders with label and helper text', () => {
  const { container } = render(
    <Input label="Название" helper="до 64 символов" placeholder="Борщ" />,
  );
  const input = getByRole(container, 'textbox', { name: 'Название' });
  assert.ok(input);
  // Helper text is rendered alongside the input and announced via aria-describedby.
  assert.match(container.textContent ?? '', /до 64 символов/);
});

test('Input fires onChange and updates value', () => {
  // React 19 + happy-dom: setting `value` directly on the DOM input then
  // dispatching a synthetic `input` event reliably triggers the React
  // onChange handler (React listens on the document for delegated events).
  let captured = '';
  const { container } = render(
    <Input
      label="Email"
      onChange={(e) => {
        captured = e.target.value;
      }}
    />,
  );
  const input = getByRole(container, 'textbox', { name: 'Email' }) as HTMLInputElement;
  const w = (globalThis as unknown as { window: Window }).window;
  const EventCtor = (w as unknown as { Event: typeof Event }).Event;
  input.addEventListener('input', () => {
    captured = input.value;
  });
  // Native setter to bypass React's input value tracker.
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
  setter?.call(input, 'a@b.c');
  input.dispatchEvent(new EventCtor('input', { bubbles: true }));
  assert.equal(captured, 'a@b.c');
});

test('Input error state shows danger border + role=alert helper', () => {
  const { container } = render(<Input label="Пароль" error="Минимум 8 символов" />);
  const input = getByRole(container, 'textbox', { name: 'Пароль' });
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.match(input.className, /border-\[var\(--color-danger\)\]/);
  const alert = container.querySelector('[role="alert"]');
  assert.ok(alert);
  assert.match(alert?.textContent ?? '', /Минимум 8 символов/);
});

test('Input helper hidden when error present', () => {
  const { container } = render(<Input label="X" helper="ignored" error="failed" />);
  assert.equal(container.textContent?.includes('ignored') ?? false, false);
  assert.equal(container.textContent?.includes('failed') ?? false, true);
});

test('Input associates helper via aria-describedby when no error', () => {
  const { container } = render(<Input label="L" helper="H" />);
  const input = getByRole(container, 'textbox', { name: 'L' });
  const describedBy = input.getAttribute('aria-describedby');
  assert.ok(describedBy, 'aria-describedby should be set');
  assert.match(describedBy, /helper/);
});
