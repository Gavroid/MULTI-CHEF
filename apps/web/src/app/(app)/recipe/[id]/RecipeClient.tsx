'use client';

// RecipeClient — the client boundary for the recipe page (MC-035).
// Owns the Next.js router plumbing: mirrors every servings change into
// the URL (?servings=N) with router.replace({ scroll: false }) so
// deep-links round-trip without a scroll jump or a refetch.
//
// Data fetching lives here too: getRecipe() with deps injection (the
// /api/v1/recipes/:id backend arrives with MC-033; until then
// NEXT_PUBLIC_USE_RECIPE_FIXTURES=1 serves the local fixture catalog).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@multichef/ui';
import { getRecipe, clampServings, type RecipeDetail } from '@/lib/recipe-client';
import { RecipeView } from './RecipeView';

export interface RecipeClientDeps {
  getRecipe: typeof getRecipe;
}

const defaultDeps: RecipeClientDeps = { getRecipe };

export interface RecipeClientProps {
  recipeId: string;
  /** Pre-parsed ?servings=N from the server component (already clamped). */
  initialServings?: number;
  deps?: Partial<RecipeClientDeps>;
}

export function RecipeClient({
  recipeId,
  initialServings,
  deps: depsOverride,
}: RecipeClientProps): React.ReactElement {
  // Memoize the merged deps — a fresh object every render would make
  // `load` a new reference each time and re-fire the fetch effect
  // forever (the runaway-refetch-loop class of bug from MC-023).
  const deps = useMemo<RecipeClientDeps>(
    () => ({ ...defaultDeps, ...depsOverride }),
    [depsOverride],
  );
  const router = useRouter();

  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTicket, setRetryTicket] = useState(0);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    const result = await deps.getRecipe(recipeId);
    if (result.error) {
      setError(result.error.error.message);
    } else {
      setRecipe(result.data);
    }
    setLoading(false);
  }, [deps, recipeId]);

  useEffect(() => {
    void load();
  }, [load, retryTicket]);

  // Keep the URL in sync with the stepper. replace() (not push()) so
  // the back button still leaves the page; scroll:false so tapping ±
  // doesn't jump the viewport.
  const handleServingsChange = useCallback(
    (servings: number): void => {
      router.replace(`?servings=${clampServings(servings)}`, { scroll: false });
    },
    [router],
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-3" data-testid="recipe-loading">
        <Skeleton className="aspect-[4/3] w-full rounded-[var(--radius-lg)]" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !recipe) {
    return (
      <div className="flex flex-col items-center gap-3 py-16" data-testid="recipe-error">
        <p className="text-sm text-[var(--color-text-muted)]">
          {error ?? 'Не удалось загрузить рецепт.'}
        </p>
        <button
          type="button"
          data-testid="recipe-retry"
          onClick={() => setRetryTicket((t) => t + 1)}
          className="h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-text)]"
        >
          Повторить
        </button>
      </div>
    );
  }

  return (
    <RecipeView
      recipe={recipe}
      {...(initialServings !== undefined ? { initialServings } : {})}
      onServingsChange={handleServingsChange}
    />
  );
}
