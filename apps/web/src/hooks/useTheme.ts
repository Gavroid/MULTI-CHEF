// useTheme — light/dark theme hook. Persists choice in localStorage so the
// selection survives reloads. Falls back to OS preference via the
// @media (prefers-color-scheme) block in globals.css when the user has
// not toggled manually.
//
// Reads the initial value lazily on mount to avoid hydration mismatch
// between SSR (no localStorage) and the client.

'use client';

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'mc-theme';
const VALID_VALUES: readonly Theme[] = ['light', 'dark'];

function readStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return VALID_VALUES.includes(raw as Theme) ? (raw as Theme) : null;
  } catch {
    // localStorage can throw in private-mode or sandboxed iframes.
    return null;
  }
}

function writeStoredTheme(value: Theme): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Ignore quota/security errors — the toggle still works for the session.
  }
}

function applyToDocument(value: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', value);
}

export function useTheme(): {
  theme: Theme | null;
  resolvedTheme: Theme;
  setTheme: (next: Theme) => void;
  toggle: () => void;
} {
  // `theme` is null until we know the user's choice (SSR-safe default).
  const [theme, setThemeState] = useState<Theme | null>(null);

  useEffect(() => {
    const stored = readStoredTheme();
    if (stored) {
      setThemeState(stored);
      applyToDocument(stored);
      return;
    }
    // No manual choice — defer to OS preference via matchMedia.
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    const initial: Theme = prefersDark ? 'dark' : 'light';
    setThemeState(initial);
    applyToDocument(initial);
  }, []);

  const setTheme = useCallback((next: Theme): void => {
    setThemeState(next);
    writeStoredTheme(next);
    applyToDocument(next);
  }, []);

  const toggle = useCallback((): void => {
    setThemeState((prev) => {
      const current: Theme = prev ?? 'light';
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      writeStoredTheme(next);
      applyToDocument(next);
      return next;
    });
  }, []);

  // Until mount, report a sensible default so SSR markup matches client.
  const resolvedTheme: Theme = theme ?? 'light';

  return { theme, resolvedTheme, setTheme, toggle };
}
