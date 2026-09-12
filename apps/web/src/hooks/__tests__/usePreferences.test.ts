// usePreferences unit tests (MC-034): success mapping, graceful
// fallback on error/404, cache behaviour, refetch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { Window } from 'happy-dom';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import {
  usePreferences,
  resetPreferencesCache,
  mapProfileToPreferences,
  EMPTY_PREFERENCES,
} from '../usePreferences';

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
  g['getComputedStyle'] = window.getComputedStyle.bind(window);
  g['requestAnimationFrame'] = (cb: (t: number) => void): number =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  g['cancelAnimationFrame'] = (id: number): void => clearTimeout(id);
}

interface ProbeProps {
  fetchProfile?: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
  onState?: (state: {
    loading: boolean;
    error: string | null;
    dietType: string;
    allergies: string[];
    refetch: () => void;
  }) => void;
}

function Probe({ fetchProfile, onState }: ProbeProps): null {
  const prefs = usePreferences(fetchProfile ? { fetchProfile } : undefined);
  onState?.({
    loading: prefs.loading,
    error: prefs.error,
    dietType: prefs.preferences.dietType,
    allergies: prefs.preferences.allergies,
    refetch: prefs.refetch,
  });
  return null;
}

function renderProbe(props: ProbeProps): {
  unmount: () => void;
} {
  installDom();
  const doc = (globalThis as unknown as Record<string, unknown>)['document'] as Document;
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(Probe, props));
  });
  return {
    unmount: (): void => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function profileResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

/* ---------------- pure mapping ---------------- */

test('mapProfileToPreferences: kinds bucketed, diet/appliances mapped', () => {
  const mapped = mapProfileToPreferences({
    nutritionProfile: { dietType: 'VEGETARIAN', appliances: ['OVEN'] },
    preferences: [
      { id: 'p1', kind: 'ALLERGY', ingredientId: 'ing_nuts', note: null },
      { id: 'p2', kind: 'LOVE', ingredientId: 'ing_pasta', note: null },
      { id: 'p3', kind: 'DISLIKE', ingredientId: 'ing_fish', note: null },
      { id: 'p4', kind: 'ALLERGY', ingredientId: null, note: 'морепродукты' },
    ],
  });
  assert.equal(mapped.dietType, 'VEGETARIAN');
  assert.deepEqual(mapped.appliances, ['OVEN']);
  assert.deepEqual(mapped.allergies, ['ing_nuts'], 'null ingredientId skipped');
  assert.deepEqual(mapped.loves, ['ing_pasta']);
  assert.deepEqual(mapped.dislikes, ['ing_fish']);
});

test('mapProfileToPreferences: empty profile → EMPTY_PREFERENCES', () => {
  assert.deepEqual(mapProfileToPreferences({}), EMPTY_PREFERENCES);
});

/* ---------------- hook ---------------- */

test('usePreferences success: maps and caches', async () => {
  resetPreferencesCache();
  installDom();
  let calls = 0;
  const states: Array<{ loading: boolean; dietType: string; allergies: string[] }> = [];
  const m = renderProbe({
    fetchProfile: () => {
      calls += 1;
      return Promise.resolve(
        profileResponse({
          data: {
            nutritionProfile: { dietType: 'VEGAN', appliances: [] },
            preferences: [{ id: 'p1', kind: 'ALLERGY', ingredientId: 'ing_soya', note: null }],
          },
        }),
      );
    },
    onState: (s) =>
      states.push({ loading: s.loading, dietType: s.dietType, allergies: s.allergies }),
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  const last = states.at(-1);
  assert.equal(last?.loading, false);
  assert.equal(last?.dietType, 'VEGAN');
  assert.deepEqual(last?.allergies, ['ing_soya']);
  assert.equal(calls, 1);
  m.unmount();

  // Second mount hits the 60s cache — no new request.
  const m2 = renderProbe({
    fetchProfile: () => {
      calls += 1;
      return Promise.resolve(profileResponse({ data: {} }));
    },
    onState: (s) =>
      states.push({ loading: s.loading, dietType: s.dietType, allergies: s.allergies }),
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  assert.equal(calls, 1, 'cache must serve the second mount');
  m2.unmount();
});

test('usePreferences: HTTP 404 → graceful empty fallback, no throw', async () => {
  resetPreferencesCache();
  const states: Array<{ loading: boolean; error: string | null; dietType: string }> = [];
  const m = renderProbe({
    fetchProfile: (() =>
      Promise.resolve({ ok: false, status: 404 } as unknown as Response)) as never,
    onState: (s) => states.push({ loading: s.loading, error: s.error, dietType: s.dietType }),
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  const last = states.at(-1);
  assert.equal(last?.loading, false);
  assert.match(last?.error ?? '', /404/);
  assert.equal(last?.dietType, 'NONE', 'graceful fallback, not a crash');
  m.unmount();
});

test('usePreferences: network rejection → graceful empty fallback', async () => {
  resetPreferencesCache();
  const states: Array<{ loading: boolean; error: string | null; dietType: string }> = [];
  const m = renderProbe({
    fetchProfile: (() => Promise.reject(new Error('offline'))) as never,
    onState: (s) => states.push({ loading: s.loading, error: s.error, dietType: s.dietType }),
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  const last = states.at(-1);
  assert.equal(last?.loading, false);
  assert.match(last?.error ?? '', /unavailable/);
  assert.equal(last?.dietType, 'NONE');
  m.unmount();
});

test('usePreferences: refetch bypasses the cache', async () => {
  resetPreferencesCache();
  let calls = 0;
  let latestRefetch: (() => void) | null = null;
  const onState = (s: { refetch: () => void }): void => {
    latestRefetch = s.refetch;
  };
  const m = renderProbe({
    fetchProfile: () => {
      calls += 1;
      return Promise.resolve(profileResponse({ data: {} }));
    },
    onState,
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  assert.equal(calls, 1);
  await act(async () => {
    latestRefetch?.();
    await new Promise((r) => setTimeout(r, 10));
  });
  assert.ok(calls >= 2, 'refetch must bypass the cache');
  m.unmount();
});
