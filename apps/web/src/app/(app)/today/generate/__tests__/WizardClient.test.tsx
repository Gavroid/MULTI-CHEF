// WizardClient tests (MC-034): prefill parsing/expansion, step
// navigation, submit payload. The wizard is mounted via happy-dom and
// driven through real clicks; router is exercised through the injected
// onSubmit seam (WizardClient uses router.push in production).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { Window } from 'happy-dom';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import {
  WizardClient,
  parsePrefill,
  initialState,
  URGENT_SETTINGS,
} from '../WizardClient';

/* ---------------- happy-dom harness ---------------- */

let installed = false;

function installDom(): void {
  if (installed) return;
  installed = true;
  const window = new Window();
  const document = window.document;
  const g = globalThis as unknown as Record<string, unknown>;
  g['window'] = window;
  g['document'] = document;
  g['self'] = window;
  Object.defineProperty(globalThis, 'navigator', {
    value: window.navigator,
    configurable: true,
    writable: true,
  });
  g['HTMLElement'] = window.HTMLElement;
  g['Element'] = window.Element;
  g['Node'] = window.Node;
  g['Event'] = window.Event;
  g['MouseEvent'] = window.MouseEvent;
  g['getComputedStyle'] = window.getComputedStyle.bind(window);
  g['requestAnimationFrame'] = (cb: (t: number) => void): number =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  g['cancelAnimationFrame'] = (id: number): void => clearTimeout(id);
}

function fireClick(target: Element): void {
  act(() => {
    const w = (globalThis as unknown as Record<string, unknown>)['window'] as Window;
    const Ctor = (w as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
    target.dispatchEvent(new Ctor('click', { bubbles: true, cancelable: true, button: 0 }));
  });
}

interface Mounted {
  q: (selector: string) => Element | null;
  unmount: () => void;
}

function render(element: React.ReactElement): Mounted {
  installDom();
  const doc = (globalThis as unknown as Record<string, unknown>)['document'] as Document;
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return {
    q: (selector: string): Element | null => container.querySelector(selector),
    unmount: (): void => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

const noop = (): void => undefined;

/* ---------------- prefill parsing ---------------- */

test('parsePrefill: NOTHING / .30. / ..NO_OVEN / URGENT / garbage', () => {
  assert.deepEqual(parsePrefill('NOTHING'), { budgetMode: 'NOTHING' });
  assert.deepEqual(parsePrefill('.30.'), { maxMinutes: 30 });
  assert.deepEqual(parsePrefill('..NO_OVEN'), { antiFilters: ['NO_OVEN'] });
  assert.deepEqual(parsePrefill('URGENT'), { urgent: true, ...URGENT_SETTINGS });
  assert.deepEqual(parsePrefill('GARBAGE'), {}, 'unknown tokens ignored');
  assert.deepEqual(parsePrefill(null), {});
});

test('initialState: NOTHING and URGENT skip the budget step', () => {
  assert.equal(initialState(parsePrefill('NOTHING')).step, 'time');
  const urgent = initialState(parsePrefill('URGENT'));
  assert.equal(urgent.step, 'time');
  assert.equal(urgent.budgetMode, 'MINIMAL');
  assert.equal(urgent.maxMinutes, 20);
  assert.deepEqual(urgent.antiFilters, ['SHORT_TIME', 'NO_MULTISTEP']);
  assert.equal(initialState(parsePrefill('..NO_OVEN')).step, 'budget');
  assert.equal(initialState().step, 'budget');
});

/* ---------------- wizard navigation ---------------- */

function mountWizard(onSubmit: (s: unknown) => void = noop): Mounted {
  return render(React.createElement(WizardClient, { prefill: null, onSubmit }));
}

test('wizard starts on budget step; next → time → anti', () => {
  const m = mountWizard();
  assert.ok(m.q('[data-testid="wizard-step-budget"]'), 'step 1 visible');
  fireClick(m.q('[data-testid="budget-NORMAL"]') as HTMLElement);
  fireClick(m.q('[data-testid="wizard-step-next"]') as HTMLElement);
  assert.ok(m.q('[data-testid="wizard-step-time"]'), 'step 2 visible');
  fireClick(m.q('[data-testid="wizard-step-next"]') as HTMLElement);
  assert.ok(m.q('[data-testid="wizard-step-anti"]'), 'step 3 visible');
  m.unmount();
});

test('wizard back: anti → time → budget', () => {
  const m = mountWizard();
  fireClick(m.q('[data-testid="budget-NORMAL"]') as HTMLElement);
  fireClick(m.q('[data-testid="wizard-step-next"]') as HTMLElement);
  fireClick(m.q('[data-testid="wizard-step-next"]') as HTMLElement);
  assert.ok(m.q('[data-testid="wizard-step-anti"]'));
  fireClick(m.q('[data-testid="wizard-step-back"]') as HTMLElement);
  assert.ok(m.q('[data-testid="wizard-step-time"]'));
  fireClick(m.q('[data-testid="wizard-step-back"]') as HTMLElement);
  assert.ok(m.q('[data-testid="wizard-step-budget"]'));
  m.unmount();
});

test('wizard progress indicator advances 1/3 → 3/3', () => {
  const m = mountWizard();
  assert.match(m.q('[data-testid="wizard-progress"]')?.textContent ?? '', /Шаг 1 из 3/);
  fireClick(m.q('[data-testid="budget-MINIMAL"]') as HTMLElement);
  fireClick(m.q('[data-testid="wizard-step-next"]') as HTMLElement);
  assert.match(m.q('[data-testid="wizard-progress"]')?.textContent ?? '', /Шаг 2 из 3/);
  fireClick(m.q('[data-testid="wizard-step-next"]') as HTMLElement);
  assert.match(m.q('[data-testid="wizard-progress"]')?.textContent ?? '', /Шаг 3 из 3/);
  m.unmount();
});

test('anti-filter toggle: select and deselect', () => {
  const m = mountWizard();
  fireClick(m.q('[data-testid="budget-NORMAL"]') as HTMLElement);
  fireClick(m.q('[data-testid="wizard-step-next"]') as HTMLElement);
  fireClick(m.q('[data-testid="wizard-step-next"]') as HTMLElement);
  const oven = m.q('[data-testid="anti-NO_OVEN"]') as HTMLElement;
  fireClick(oven);
  assert.equal(m.q('[data-testid="anti-NO_OVEN"]')?.getAttribute('aria-checked'), 'true');
  fireClick(m.q('[data-testid="anti-NO_OVEN"]') as HTMLElement);
  assert.equal(m.q('[data-testid="anti-NO_OVEN"]')?.getAttribute('aria-checked'), 'false');
  m.unmount();
});

test('submit on step 3 delivers the full settings payload', () => {
  let captured: { budgetMode: string; maxMinutes: number; antiFilters: string[] } | null = null;
  const m = render(
    React.createElement(WizardClient, {
      prefill: null,
      onSubmit: (s) => {
        captured = s as typeof captured;
      },
    }),
  );
  fireClick(m.q('[data-testid="budget-MINIMAL"]') as HTMLElement);
  fireClick(m.q('[data-testid="wizard-step-next"]') as HTMLElement);
  fireClick(m.q('[data-testid="time-chip-30"]') as HTMLElement);
  fireClick(m.q('[data-testid="wizard-step-next"]') as HTMLElement);
  fireClick(m.q('[data-testid="anti-NO_OVEN"]') as HTMLElement);
  fireClick(m.q('[data-testid="wizard-submit"]') as HTMLElement);
  assert.deepEqual(captured, {
    budgetMode: 'MINIMAL',
    maxMinutes: 30,
    antiFilters: ['NO_OVEN'],
  });
  m.unmount();
});

test('URGENT prefill: starts on step 2 with expanded settings intact', () => {
  let captured: { budgetMode: string; maxMinutes: number; antiFilters: string[] } | null = null;
  const m = render(
    React.createElement(WizardClient, {
      prefill: 'URGENT',
      onSubmit: (s) => {
        captured = s as typeof captured;
      },
    }),
  );
  assert.ok(m.q('[data-testid="wizard-step-time"]'), 'budget step skipped');
  assert.match(m.q('[data-testid="time-value"]')?.textContent ?? '', /20/);
  fireClick(m.q('[data-testid="wizard-step-next"]') as HTMLElement);
  fireClick(m.q('[data-testid="wizard-submit"]') as HTMLElement);
  assert.deepEqual(captured, {
    budgetMode: 'MINIMAL',
    maxMinutes: 20,
    antiFilters: ['SHORT_TIME', 'NO_MULTISTEP'],
  });
  m.unmount();
});
