'use client';

// ResultClient — /today/result?ref=X (MC-034, PRD §2.3.4).
//
// Reads the recommendation from sessionStorage (saved by LoadingClient
// under ?ref=<uuid>, TTL 30 min). Missing/expired → toast + redirect
// to /today (manager requirement). «Готовлю это» → acceptRecommendation
// (mock until MC-051) → /shopping/<shoppingListId>. «Другое блюдо» →
// back to /today/generate for a fresh round.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Button, Card, toast } from '@multichef/ui';
import { acceptRecommendation as acceptRecommendationApi } from '@/lib/recommendations-client';
import { TabTitle } from '@/components/TabTitle';
import { loadSessionResult, type SessionResult } from '../loading/LoadingClient';
import { OptionCard } from './components/OptionCard';

export interface ResultClientDeps {
  acceptRecommendation: typeof acceptRecommendationApi;
}

const defaultDeps: ResultClientDeps = { acceptRecommendation: acceptRecommendationApi };

export interface ResultClientProps {
  deps?: Partial<ResultClientDeps>;
}

export function ResultClient({ deps: depsOverride }: ResultClientProps): React.ReactElement {
  const deps = useMemo<ResultClientDeps>(
    () => ({ ...defaultDeps, ...depsOverride }),
    [depsOverride],
  );
  const router = useRouter();
  const searchParams = useSearchParams();
  const ref = searchParams.get('ref');

  const [session, setSession] = useState<SessionResult | null>(null);
  const [checkedSession, setCheckedSession] = useState(false);
  const [busyRecipeId, setBusyRecipeId] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const redirectedRef = useRef(false);

  useEffect(() => {
    const loaded = loadSessionResult(ref);
    setSession(loaded);
    setCheckedSession(true);
    if (!loaded && !redirectedRef.current) {
      redirectedRef.current = true;
      toast.show({ message: 'Рекомендация устарела', tone: 'warning' });
      router.push('/today');
    }
  }, [ref, router]);

  const handleAccept = useCallback(
    async (recipeId: string): Promise<void> => {
      if (!session) return;
      setBusyRecipeId(recipeId);
      setAcceptError(null);
      const servings =
        session.result.options.find((o) => o.recipe.id === recipeId)?.recipe.servings ?? 2;
      const result = await deps.acceptRecommendation({ recipeId, servings });
      if (result.error) {
        setBusyRecipeId(null);
        if (result.error.error.code === 'NOT_FOUND') {
          setAcceptError('Пока не работает — скоро');
          return;
        }
        setAcceptError(result.error.error.message);
        return;
      }
      toast.show({ message: 'План создан!', tone: 'success' });
      router.push('/shopping');
    },
    [deps, router, session],
  );

  if (!checkedSession) {
    return (
      <div
        className="py-10 text-center text-sm text-[var(--color-text-muted)]"
        data-testid="result-loading"
      >
        Загрузка…
      </div>
    );
  }

  if (!session) {
    // Render nothing — the effect is redirecting to /today.
    return <div className="py-10" data-testid="result-expired" />;
  }

  return (
    <>
      <TabTitle sublabel="3 варианта на сегодня">Ваш выбор</TabTitle>

      {session.result.options.map((option) => (
        <OptionCard
          key={option.type}
          option={option}
          onAccept={(recipeId) => void handleAccept(recipeId)}
          acceptBusy={busyRecipeId !== null}
          acceptError={busyRecipeId === null ? acceptError : null}
        />
      ))}

      <Card className="mb-6" data-testid="result-refresh">
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => router.push('/today/generate')}
          data-testid="another-dish"
        >
          <RefreshCw size={18} aria-hidden /> Другое блюдо
        </Button>
      </Card>
    </>
  );
}
