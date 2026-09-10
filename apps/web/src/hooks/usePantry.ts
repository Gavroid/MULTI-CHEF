'use client';

// usePantry — shared hook that loads the household's active pantry
// items and exposes { items, loading, error, refetch } (MC-035).
//
// Consumers (recipe page «есть дома» checkboxes, future rescue /
// leftovers screens) must treat the result as read-only truth about
// the pantry: while `loading` is true or `error` is non-null the
// items array is empty, so checkbox logic can never produce a
// false ✓ (MC-035 red flags #6/#7).
//
// Cache: a 30-second in-memory window at module scope, so several
// components on one page share a single request. `refetch` always
// bypasses the cache (after pantry mutations elsewhere).

import { useCallback, useEffect, useRef, useState } from 'react';
import { type ApiResponse } from '@/lib/auth-client';
import { listItems, type ListPantryItemsOptions, type PantryItem } from '@/lib/pantry-client';

const CACHE_TTL_MS = 30_000;

export interface UsePantryResult {
  items: PantryItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export type UsePantryDeps = {
  listItems: (
    options?: ListPantryItemsOptions,
    fetchOptions?: { signal?: AbortSignal },
  ) => Promise<ApiResponse<PantryItem[]>>;
};

interface CacheEntry {
  items: PantryItem[];
  fetchedAt: number;
}

let cache: CacheEntry | null = null;

/** Test seam: reset the module-scope cache between tests. */
export function resetPantryCache(): void {
  cache = null;
}

export function usePantry(deps?: Partial<UsePantryDeps>): UsePantryResult {
  const list = deps?.listItems ?? listItems;
  const listRef = useRef(list);
  listRef.current = list;

  const [items, setItems] = useState<PantryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  // `ticket` increments on refetch — changing it re-runs the effect.
  const [ticket, setTicket] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const serveCache = (): boolean => {
      if (cache !== null && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
        setItems(cache.items);
        setLoading(false);
        setError(null);
        return true;
      }
      return false;
    };

    if (serveCache()) {
      return () => controller.abort();
    }

    setLoading(true);
    setError(null);
    listRef
      .current({ includeArchived: false }, { signal: controller.signal })
      .then((result) => {
        if (cancelled) return;
        if (result.error) {
          setError(result.error.error.message);
          setItems([]);
        } else {
          setItems(result.data);
          cache = { items: result.data, fetchedAt: Date.now() };
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Не удалось загрузить холодильник');
        setItems([]);
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

  return { items, loading, error, refetch };
}
