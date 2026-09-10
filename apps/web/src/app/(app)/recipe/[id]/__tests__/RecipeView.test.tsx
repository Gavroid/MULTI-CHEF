// RecipeView — state machine tests (MC-035): stepper, tabs, pantry
// checkboxes. Mounted with react-dom + happy-dom through a tiny
// file-local harness; usePantry's data source is injected, no network.
//
// All queries are scoped to the test's own container — happy-dom
// containers from previous tests stay in document.body (unmount
// removes them, but a crashed test may leak one), so document-scoped
// queries can match stale DOM from another test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { Window } from 'happy-dom';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import { RecipeView } from '../RecipeView';
import type { RecipeDetail } from '@/lib/recipe-client';
import { resetPantryCache } from '@/hooks/usePantry';
import fixtureFile from '@/lib/recipe-fixtures.json';

/* ---------------- happy-dom harness (file-local) ---------------- */

let installed = false;

function installDom(): void {
  if (installed) return;
  installed = true;
  const window = new Window();
  const document = window.document;
  const g = globalThis as unknown as Record<string, unknown>;
  g['window'] = window;
  g['document'] = document;
  // next/link (useIntersection → requestIdleCallback) reads `self`.
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

/**
 * Poll `predicate` until it returns true — replaces fixed sleeps, which
 * race the pantry promise on slow CI runners (a 10ms sleep was enough
 * locally but not under turbo's parallel load; GitHub Actions run
 * 34512503775 failed exactly this way: the checkbox had not rendered
 * yet, querySelector returned null, getAttribute → undefined).
 */
async function waitFor(
  predicate: () => boolean,
  { intervalMs = 5, timeoutMs = 2000 }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('waitFor: condition not met within timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
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

/* ---------------- fixtures ---------------- */

const recipes = (fixtureFile as unknown as { recipes: RecipeDetail[] }).recipes;
const pasta = recipes.find((r) => r.id === 'r_pasta_grib') as RecipeDetail;

const pantryFixture = [
  { ingredientId: 'ing_pasta', estimatedGrams: 500, archivedAt: null },
  { ingredientId: 'ing_mushrooms', estimatedGrams: 400, archivedAt: null },
  { ingredientId: 'ing_cream', estimatedGrams: 100, archivedAt: null },
];

const stubPantry = (): { listItems: () => Promise<unknown> } => ({
  listItems: (): Promise<unknown> => Promise.resolve({ data: pantryFixture, error: undefined }),
});

const emptyPantry = (): { listItems: () => Promise<unknown> } => ({
  listItems: (): Promise<unknown> => Promise.resolve({ data: [], error: undefined }),
});

const failingPantry = (): { listItems: () => Promise<unknown> } => ({
  listItems: (): Promise<unknown> =>
    Promise.resolve({ error: { status: 500, error: { code: 'X', message: 'бум' } } }),
});

/* ---------------- default state ---------------- */

test('RecipeView defaults: servings = recipe.servings, ingredients tab', () => {
  resetPantryCache();
  const m = render(
    React.createElement(RecipeView, {
      recipe: pasta,
      pantryDeps: stubPantry() as never,
    }),
  );
  assert.match(m.q('[data-testid="servings-value"]')?.textContent ?? '', /2/);
  assert.ok(m.q('[data-testid="panel-ingredients"]'), 'ingredients tab default');
  assert.ok(!m.q('[data-testid="panel-steps"]'), 'no other panel mounted');
  m.unmount();
});

/* ---------------- stepper math ---------------- */

test('servings 2 → 4 doubles grams; back to 2 restores originals (round-trip)', () => {
  resetPantryCache();
  const m = render(
    React.createElement(RecipeView, {
      recipe: pasta,
      pantryDeps: stubPantry() as never,
    }),
  );
  const plus = m.q('[data-testid="servings-stepper-plus"]') as HTMLElement;
  const minus = m.q('[data-testid="servings-stepper-minus"]') as HTMLElement;
  assert.ok(plus && minus);

  fireClick(plus);
  fireClick(plus);
  assert.match(m.q('[data-testid="servings-value"]')?.textContent ?? '', /4/);
  assert.match(
    m.q('[data-testid="ingredient-row-ing_pasta"]')?.textContent ?? '',
    /400/,
    '200 × 2 = 400 г',
  );

  fireClick(minus);
  fireClick(minus);
  assert.match(
    m.q('[data-testid="ingredient-row-ing_pasta"]')?.textContent ?? '',
    /200/,
    'round-trip back to 200 г',
  );
  m.unmount();
});

test('servings 1 → 12 boundary clamps at both ends', () => {
  resetPantryCache();
  const m = render(
    React.createElement(RecipeView, {
      recipe: pasta,
      pantryDeps: stubPantry() as never,
    }),
  );
  const plus = m.q('[data-testid="servings-stepper-plus"]') as HTMLElement;
  const minus = m.q('[data-testid="servings-stepper-minus"]') as HTMLElement;
  for (let i = 0; i < 20; i += 1) fireClick(plus);
  assert.match(m.q('[data-testid="servings-value"]')?.textContent ?? '', /12/);
  assert.equal(plus.hasAttribute('disabled'), true, 'plus disabled at max');
  for (let i = 0; i < 20; i += 1) fireClick(minus);
  assert.match(m.q('[data-testid="servings-value"]')?.textContent ?? '', /\b1\b/);
  assert.equal(minus.hasAttribute('disabled'), true, 'minus disabled at min');
  m.unmount();
});

/* ---------------- tabs ---------------- */

test('tab switching ingredients → steps → nutrition → storage → ingredients', () => {
  resetPantryCache();
  const m = render(
    React.createElement(RecipeView, {
      recipe: pasta,
      pantryDeps: stubPantry() as never,
    }),
  );
  for (const id of ['steps', 'nutrition', 'storage', 'ingredients']) {
    fireClick(m.q(`[data-testid="tab-${id}"]`) as HTMLElement);
    assert.ok(m.q(`[data-testid="panel-${id}"]`), `panel ${id} visible after click`);
  }
  m.unmount();
});

test('nutrition tab: disclaimer text + scaled total + per-serving block', () => {
  resetPantryCache();
  const m = render(
    React.createElement(RecipeView, {
      recipe: pasta,
      pantryDeps: stubPantry() as never,
    }),
  );
  fireClick(m.q('[data-testid="tab-nutrition"]') as HTMLElement);
  const disclaimer = m.q('[data-testid="nutrition-disclaimer"]');
  assert.ok(disclaimer, 'disclaimer rendered');
  assert.match(disclaimer?.textContent ?? '', /Значения КБЖУ ориентировочные/);
  assert.match(
    m.q('[data-testid="nutrition-total"]')?.textContent ?? '',
    /1240/,
    '620 × 2 servings at default',
  );
  assert.match(
    m.q('[data-testid="nutrition-per-serving"]')?.textContent ?? '',
    /620/,
    'per-serving unchanged',
  );
  m.unmount();
});

/* ---------------- pantry checkboxes ---------------- */

test('checkboxes: pantry-covered ✓, insufficient ✗, toggle without network', async () => {
  resetPantryCache();
  let fetchCalled = 0;
  const g = globalThis as unknown as Record<string, unknown>;
  const origFetch = g['fetch'];
  g['fetch'] = () => {
    fetchCalled += 1;
    return Promise.reject(new Error('no network in test'));
  };
  try {
    const m = render(
      React.createElement(RecipeView, {
        recipe: pasta,
        pantryDeps: stubPantry() as never,
      }),
    );
    // Wait for the pantry promise to resolve and the checkboxes to
    // render (never a fixed sleep — races on slow CI runners).
    await waitFor(() => m.q('[data-testid="ingredient-check-ing_pasta"]') !== null);

    // pasta 500 ≥ 200 needed → checked; cream 100 < 150 → unchecked.
    const pastaCheck = m.q('[data-testid="ingredient-check-ing_pasta"]');
    const creamCheck = m.q('[data-testid="ingredient-check-ing_cream"]');
    assert.equal(pastaCheck?.getAttribute('aria-checked'), 'true', 'pasta covered');
    assert.equal(creamCheck?.getAttribute('aria-checked'), 'false', 'cream insufficient');

    fireClick(creamCheck as HTMLElement);
    assert.equal(
      m.q('[data-testid="ingredient-check-ing_cream"]')?.getAttribute('aria-checked'),
      'true',
      'local toggle flips without network',
    );
    assert.equal(fetchCalled, 0, 'toggle must not trigger any fetch');
    m.unmount();
  } finally {
    g['fetch'] = origFetch;
  }
});

test('pantry error → banner + no false ✓', async () => {
  resetPantryCache();
  const m = render(
    React.createElement(RecipeView, {
      recipe: pasta,
      pantryDeps: failingPantry() as never,
    }),
  );
  // Wait for the rejected promise to surface the error banner.
  await waitFor(() => m.q('[data-testid="pantry-error-banner"]') !== null);
  assert.ok(m.q('[data-testid="pantry-error-banner"]'), 'error banner visible');
  assert.equal(
    m.q('[data-testid="ingredient-check-ing_pasta"]')?.getAttribute('aria-checked'),
    'false',
    'no false ✓ on pantry error',
  );
  m.unmount();
});

test('empty pantry → missing badge counts required ingredients', async () => {
  resetPantryCache();
  const m = render(
    React.createElement(RecipeView, {
      recipe: pasta,
      pantryDeps: emptyPantry() as never,
    }),
  );
  // Wait for the (empty) pantry promise to resolve and the badge to render.
  await waitFor(() => m.q('[data-testid="missing-badge"]') !== null);
  const badge = m.q('[data-testid="missing-badge"]');
  assert.ok(badge, 'badge visible when pantry empty');
  assert.match(badge?.textContent ?? '', /Не хватает: 3 из 3/);
  m.unmount();
});
