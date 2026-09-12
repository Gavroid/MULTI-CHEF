'use client';

// usePreferences — shared hook reading GET /api/v1/profile (MC-034).
//
// The MC-033 wire shape (apps/api/src/profile/profile.service.ts) is:
//   { user, household: { …, budgetWeekKopecks },
//     nutritionProfile: { … } | null,
//     preferences: [{ id, kind, ingredientId, note }] }
//
// We map that into the narrow UserPreferences view the /today screen
// needs. Graceful fallback per manager decision #2: any failure (404,
// network, unexpected shape) yields EMPTY_PREFERENCES, never a crash —
// preferences are an enhancement, not a blocker.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '@/lib/env';

const CACHE_TTL_MS = 60_000;

export interface UserPreferences {
  dietType: string;
  appliances: string[];
  allergies: string[];
  loves: string[];
  dislikes: string[];
}

export const EMPTY_PREFERENCES: UserPreferences = {
  dietType: 'NONE',
  appliances: [],
  allergies: [],
  loves: [],
  dislikes: [],
};

export interface UsePreferencesResult {
  preferences: UserPreferences;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export type UsePreferencesDeps = {
  fetchProfile?: (
    url: string,
    init?: { signal?: AbortSignal },
  ) => Promise<Response>;
};

interface ProfileWire {
  household?: { budgetWeekKopecks?: number | null };
  nutritionProfile?: {
    dietType?: string | null;
    appliances?: string[] | null;
  } | null;
  preferences?: Array<{
    id: string;
    kind: string;
    ingredientId: string | null;
    note: string | null;
  }>;
}

/** Map the raw profile bundle to the narrow preferences view. */
export function mapProfileToPreferences(raw: ProfileWire): UserPreferences {
  const prefs = raw.preferences ?? [];
  const byKind = (kind: string): string[] =>
    prefs
      .filter((p) => p.kind === kind && p.ingredientId !== null)
      .map((p) => p.ingredientId as string);
  return {
    dietType: raw.nutritionProfile?.dietType ?? 'NONE',
    appliances: raw.nutritionProfile?.appliances ?? [],
    allergies: byKind('ALLERGY'),
    loves: byKind('LOVE'),
    dislikes: byKind('DISLIKE'),
  };
}

interface CacheEntry {
  preferences: UserPreferences;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;

/** Test seam: reset the module-scope cache between tests. */
export function resetPreferencesCache(): void {
  cache = null;
}

export function usePreferences(deps?: Partial<UsePreferencesDeps>): UsePreferencesResult {
  const fetchProfile = deps?.fetchProfile;
  const fetchRef = useRef(fetchProfile);
  fetchRef.current = fetchProfile;

  const [preferences, setPreferences] = useState<UserPreferences>(EMPTY_PREFERENCES);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    if (cache !== null && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      setPreferences(cache.preferences);
      setLoading(false);
      setError(null);
      return () => controller.abort();
    }

    setLoading(true);
    setError(null);
    const base = getApiBaseUrl();
    const doFetch = fetchRef.current ?? ((url: string, init?: { signal?: AbortSignal }) =>
      fetch(url, { credentials: 'include', ...(init?.signal ? { signal: init.signal } : {}) }));

    doFetch(`${base}/api/v1/profile`, { signal: controller.signal })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          // Graceful fallback (manager default #2): unavailable profile
          // is not an error state for the UI — empty preferences.
          setPreferences(EMPTY_PREFERENCES);
          setError(`profile_http_${res.status}`);
          setLoading(false);
          return;
        }
        const json = (await res.json()) as { data?: ProfileWire };
        const mapped = mapProfileToPreferences(json.data ?? {});
        cache = { preferences: mapped, fetchedAt: Date.now() };
        setPreferences(mapped);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPreferences(EMPTY_PREFERENCES);
        setError('preferences_unavailable');
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [ticket]);

  const refetch = useCallback((): void => {
    cache = null;
    setTicket((t) => t + 1);
  }, []);

  return { preferences, loading, error, refetch };
}
