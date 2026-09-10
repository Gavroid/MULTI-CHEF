// usePantry unit tests (MC-035): success / loading / error / refetch /
// cache. Mounted through a tiny happy-dom harness; the data source is
// injected via deps so no network runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { Window } from 'happy-dom';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import { usePantry, resetPantryCache } from '../usePantry';

/* ---------------- harness ---------------- */

let installed = false;

function installDom(): void {
  if (installed) return;
  installed = true;
  const window = new Window();
  const document = window.document;
  const g = globalThis as unknown as Record<string, unknown>;
  g['window'] = window;
  g['document'] = document;
  Object.defineProperty(globalThis, 'navigator', {
    value: window.navigator,
    configurable: true,
    writable: true,
  });
  g['HTMLElement'] = window.HTMLElement;
  g['Element'] = window.Element;
  g['Node'] = window.Node;
  g['Event'] = window.Event;
  g['getComputedStyle'] = window.getComputedStyle.bind(window);
  g['requestAnimationFrame'] = (cb: (t: number) => void): number =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  g['cancelAnimationFrame'] = (id: number): void => clearTimeout(id);
}

interface ProbeProps {
  list: (options?: unknown, fetchOptions?: unknown) => Promise<unknown>;
  onState?: (state: {
    loading: boolean;
    error: string | null;
    count: number;
    refetch: () => void;
  }) => void;
}

function Probe({ list, onState }: ProbeProps): null {
  const pantry = usePantry({ listItems: list as never });
  onState?.({
    loading: pantry.loading,
    error: pantry.error,
    count: pantry.items.length,
    refetch: pantry.refetch,
  });
  return null;
}

function renderProbe(props: ProbeProps): {
  setProps: (next: Partial<ProbeProps>) => void;
  unmount: () => void;
} {
  installDom();
  const doc = (globalThis as unknown as { document: Document }).document;
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);
  let current: ProbeProps = props;
  const mount = (): void => {
    act(() => {
      root.render(React.createElement(Probe, current));
    });
  };
  mount();
  return {
    setProps(next) {
      current = { ...current, ...next };
      mount();
    },
    unmount: (): void => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/* ---------------- tests ---------------- */

const item = (id: string, grams: number): unknown => ({
  id,
  ingredientId: id,
  estimatedGrams: grams,
  archivedAt: null,
});

test('usePantry success: loading → items', async () => {
  resetPantryCache();
  const states: Array<{ loading: boolean; error: string | null; count: number }> = [];
  const { unmount } = renderProbe({
    list: () =>
      Promise.resolve({ data: [item('a', 100), item('b', 200)], error: undefined }) as never,
    onState: (s) => states.push({ ...s }),
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  const last = states.at(-1);
  assert.equal(last?.loading, false);
  assert.equal(last?.error, null);
  assert.equal(last?.count, 2);
  unmount();
});

test('usePantry error: message surfaces, items stay empty', async () => {
  resetPantryCache();
  const states: Array<{ loading: boolean; error: string | null; count: number }> = [];
  const { unmount } = renderProbe({
    list: () =>
      Promise.resolve({
        error: { status: 500, error: { code: 'X', message: 'бум' } },
      }) as never,
    onState: (s) => states.push({ ...s }),
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  const last = states.at(-1);
  assert.equal(last?.loading, false);
  assert.match(last?.error ?? '', /бум/);
  assert.equal(last?.count, 0);
  unmount();
});

test('usePantry rejection: friendly message, no throw', async () => {
  resetPantryCache();
  const states: Array<{ loading: boolean; error: string | null; count: number }> = [];
  const { unmount } = renderProbe({
    list: () => Promise.reject(new Error('socket hang up')) as never,
    onState: (s) => states.push({ ...s }),
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  const last = states.at(-1);
  assert.equal(last?.loading, false);
  assert.match(last?.error ?? '', /холодильник/);
  unmount();
});

test('usePantry cache: second mount within TTL does not refetch; refetch bypasses', async () => {
  resetPantryCache();
  let calls = 0;
  const list = (): Promise<unknown> => {
    calls += 1;
    return Promise.resolve({ data: [item('a', 1)], error: undefined }) as never;
  };
  let latestRefetch: (() => void) | null = null;
  const onState = (s: { refetch: () => void }): void => {
    latestRefetch = s.refetch;
  };
  const first = renderProbe({ list, onState });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  first.unmount();

  const second = renderProbe({ list, onState });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  assert.equal(calls, 1, 'second mount must hit the 30s cache');

  // refetch bypasses the cache
  await act(async () => {
    latestRefetch?.();
    await new Promise((r) => setTimeout(r, 10));
  });
  assert.ok(calls >= 2, 'refetch must bypass the cache');
  second.unmount();
});
