'use client';

// RescueClient — /fridge/rescue orchestrator (MC-040, PRD §2.3.7).
//
// URL-driven state machine; page.tsx passes the parsed query params:
//   step=picker                     → IngredientPicker (default)
//   step=loading&ingredient=<id>    → POST /recommendations/rescue
//   step=result&resultRef=<uuid>    → RescueResults from sessionStorage
//
// The rescue result is stored under `mc-rescue-<ref>` (TTL 30 min) —
// the same hand-off pattern as MC-034's /today/result. Fetch failures
// render RescueError with retry; a missing/expired session redirects
// back to the picker with a toast (MC-034 precedent).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@multichef/ui';
import {
  acceptRecommendation as acceptRecommendationApi,
  getRescueRecommendations as getRescueRecommendationsApi,
} from '@/lib/recommendations-client';
import { loadRescueSession, saveRescueSession, type RescueSession } from '@/lib/rescue-session';
import { IngredientPicker } from './components/IngredientPicker';
import { RescueResults } from './components/RescueResults';
import { RescueError } from './components/RescueError';

export type RescueFetchError = {
  status: number;
  code: string;
  message: string;
};

export interface RescueClientDeps {
  getRescueRecommendations: typeof getRescueRecommendationsApi;
  acceptRecommendation: typeof acceptRecommendationApi;
}

const defaultDeps: RescueClientDeps = {
  getRescueRecommendations: getRescueRecommendationsApi,
  acceptRecommendation: acceptRecommendationApi,
};

export interface RescueClientProps {
  step: string;
  ingredient: string | null;
  resultRef: string | null;
  deps?: Partial<RescueClientDeps>;
}

export function RescueClient({
  step,
  ingredient,
  resultRef,
  deps: depsOverride,
}: RescueClientProps): React.ReactElement {
  const deps = useMemo<RescueClientDeps>(
    () => ({ ...defaultDeps, ...depsOverride }),
    [depsOverride],
  );
  const router = useRouter();
  const navigate = useCallback((url: string) => void router.push(url), [router]);

  const [session, setSession] = useState<RescueSession | null>(null);
  const [checkedSession, setCheckedSession] = useState(false);
  const [fetchError, setFetchError] = useState<RescueFetchError | null>(null);
  const [busyRecipeId, setBusyRecipeId] = useState<string | null>(null);
  const didFetchRef = useRef(false);

  const isLoading = step === 'loading';
  const isResult = step === 'result';

  // Fire the rescue POST once per loading screen mount (StrictMode in
  // dev mounts twice — the didFetchRef short-circuit keeps it single).
  useEffect(() => {
    if (!isLoading || !ingredient || didFetchRef.current) return;
    didFetchRef.current = true;
    void deps
      .getRescueRecommendations({ ingredientId: ingredient })
      .then((res) => {
        if (res.error) {
          setFetchError({
            status: res.error.status,
            code: res.error.error.code,
            message: res.error.error.message,
          });
          return;
        }
        const ref = saveRescueSession(res.data);
        navigate(`/fridge/rescue?step=result&resultRef=${encodeURIComponent(ref)}`);
      })
      .catch(() => {
        setFetchError({
          status: 0,
          code: 'NETWORK',
          message: 'Не удалось связаться с сервером',
        });
      });
  }, [deps, ingredient, isLoading, navigate]);

  // Result screen: read the session store once; expired → toast + picker.
  useEffect(() => {
    if (!isResult) return;
    setSession(loadRescueSession(resultRef));
    setCheckedSession(true);
  }, [isResult, resultRef]);

  useEffect(() => {
    if (isResult && checkedSession && !session) {
      toast.show({ message: 'Рекомендация устарела', tone: 'warning' });
      navigate('/fridge/rescue?step=picker');
    }
  }, [checkedSession, isResult, navigate, session]);

  if (isLoading) {
    if (fetchError) {
      return (
        <RescueError
          kind={
            fetchError.code === 'INGREDIENT_NOT_FOUND'
              ? 'not-found'
              : fetchError.code === 'EMPTY_RESCUE'
                ? 'empty'
                : 'network'
          }
          message={fetchError.message}
          onRetry={() => {
            didFetchRef.current = false;
            setFetchError(null);
          }}
          onAnother={() => navigate('/fridge/rescue?step=picker')}
        />
      );
    }
    if (!ingredient) {
      // Deep-link without an ingredient — back to the picker.
      navigate('/fridge/rescue?step=picker');
      return <div className="py-10" data-testid="rescue-redirect" />;
    }
    return (
      <div
        className="py-16 text-center text-sm text-[var(--color-text-muted)]"
        data-testid="rescue-loading"
      >
        Подбираем рецепты…
      </div>
    );
  }

  if (isResult) {
    if (!session || !checkedSession) {
      return (
        <div
          className="py-16 text-center text-sm text-[var(--color-text-muted)]"
          data-testid="rescue-result-loading"
        >
          Загрузка…
        </div>
      );
    }
    return (
      <RescueResults
        result={session.result}
        acceptBusy={busyRecipeId !== null}
        onAccept={(recipeId) => {
          setBusyRecipeId(recipeId);
          void deps
            .acceptRecommendation({
              recipeId,
              servings:
                session.result.options.find((o) => o.recipe.id === recipeId)?.recipe.servings ?? 2,
            })
            .then((res) => {
              if (res.error) {
                setBusyRecipeId(null);
                toast.show({ message: 'Пока не работает — скоро', tone: 'warning' });
                return;
              }
              toast.show({ message: 'План создан!', tone: 'success' });
              navigate(`/shopping/${res.data.shoppingListId}`);
            });
        }}
        onAnother={() => navigate('/fridge/rescue?step=picker')}
      />
    );
  }

  // picker (default)
  return (
    <IngredientPicker
      onPick={(id) => navigate(`/fridge/rescue?step=loading&ingredient=${encodeURIComponent(id)}`)}
      onBack={() => navigate('/fridge')}
    />
  );
}
