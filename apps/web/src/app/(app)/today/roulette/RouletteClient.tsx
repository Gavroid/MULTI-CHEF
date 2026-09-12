'use client';

// RouletteClient — /today/roulette (MC-042, PRD §2.3.5).
//
// Flow: mini-form (budget + time chips) → «Крутить» → draw → closed
// card → tap flips it (500ms) → «Беру!» (accept → /shopping/<id>) or
// «Другое» (server-side reject; max 2, then «Судьба выбрана» — the
// server answers 409 REJECT_LIMIT_REACHED and the button locks).

import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dices, Sparkles } from 'lucide-react';
import { Badge, Button, Card, Chip, toast } from '@multichef/ui';
import {
  acceptRecommendation as acceptRecommendationApi,
  drawRoulette as drawRouletteApi,
  rejectRoulette as rejectRouletteApi,
} from '@/lib/recommendations-client';
import type { BudgetMode, RouletteDrawResponseDto } from '@multichef/contracts';
import { TabTitle } from '@/components/TabTitle';

export const TIME_CHIPS = [15, 30, 60, 120] as const;

/** RU label for the remaining rejects (PRD: 2 → 1 → 0). */
export function attemptsLabel(attemptsLeft: number): string {
  if (attemptsLeft <= 0) return 'Попыток не осталось';
  if (attemptsLeft === 1) return 'Осталась 1 попытка';
  return `Осталось ${attemptsLeft} попытки`;
}

export interface RouletteCardProps {
  drawn: RouletteDrawResponseDto;
  flipped: boolean;
  acceptBusy: boolean;
  fateLocked: boolean;
  onFlip: () => void;
  onAccept: () => void;
  onAnother: () => void;
}

/** Closed/flipped card + actions. Pure props → renderToString-testable. */
export function RouletteCard({
  drawn,
  flipped,
  acceptBusy,
  fateLocked,
  onFlip,
  onAccept,
  onAnother,
}: RouletteCardProps): React.ReactElement {
  const { option, attemptsLeft } = drawn;
  return (
    <>
      <button
        type="button"
        onClick={flipped ? undefined : onFlip}
        className="mb-3 w-full"
        data-testid="roulette-card"
        aria-label={flipped ? 'Ваше блюдо' : 'Открыть блюдо'}
      >
        {flipped ? (
          <Card className="border-[var(--color-primary)] py-8" data-testid="roulette-card-open">
            <Badge tone="info">{Math.round(option.score * 100)}%</Badge>
            <h2 className="text-display mt-2">{option.recipe.title}</h2>
            <p className="text-body mt-2 text-[var(--color-text-muted)]">
              {option.recipe.prepMinutes + option.recipe.cookMinutes} мин · {option.explanation}
            </p>
          </Card>
        ) : (
          <Card className="mc-flip-back py-16 text-center" data-testid="roulette-card-closed">
            <Dices size={48} className="mx-auto" aria-hidden />
            <p className="text-body mt-3">Нажмите, чтобы открыть блюдо</p>
          </Card>
        )}
      </button>

      <Card className="mb-4" data-testid="roulette-actions">
        <div className="flex gap-2">
          <Button
            variant="primary"
            className="flex-1"
            disabled={!flipped || acceptBusy}
            onClick={onAccept}
            data-testid="roulette-accept"
          >
            <Sparkles size={18} aria-hidden /> Беру!
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            disabled={fateLocked || attemptsLeft <= 0 || acceptBusy}
            onClick={onAnother}
            data-testid="roulette-another"
          >
            Другое
          </Button>
        </div>
        <p
          className="text-caption mt-2 text-center text-[var(--color-text-muted)]"
          data-testid="roulette-attempts"
        >
          {fateLocked ? 'Судьба выбрана' : attemptsLabel(attemptsLeft)}
        </p>
      </Card>
    </>
  );
}

export interface RouletteClientDeps {
  drawRoulette: typeof drawRouletteApi;
  rejectRoulette: typeof rejectRouletteApi;
  acceptRecommendation: typeof acceptRecommendationApi;
}

const defaultDeps: RouletteClientDeps = {
  drawRoulette: drawRouletteApi,
  rejectRoulette: rejectRouletteApi,
  acceptRecommendation: acceptRecommendationApi,
};

export function RouletteClient({
  deps: depsOverride,
}: {
  deps?: Partial<RouletteClientDeps>;
}): React.ReactElement {
  const deps = useMemo<RouletteClientDeps>(
    () => ({ ...defaultDeps, ...depsOverride }),
    [depsOverride],
  );
  const router = useRouter();

  const [budget, setBudget] = useState<BudgetMode | null>(null);
  const [maxMinutes, setMaxMinutes] = useState<number | null>(null);
  const [drawn, setDrawn] = useState<RouletteDrawResponseDto | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [fateLocked, setFateLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draw = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const res = await deps.drawRoulette({
      ...(budget ? { budgetMode: budget } : {}),
      ...(maxMinutes ? { maxMinutes } : {}),
    });
    setBusy(false);
    if (res.error) {
      setError(res.error.error.message);
      return;
    }
    setDrawn(res.data);
    setFlipped(false);
  }, [budget, deps, maxMinutes]);

  const handleAnother = useCallback(async (): Promise<void> => {
    setBusy(true);
    const res = await deps.rejectRoulette();
    if (res.error) {
      setBusy(false);
      if (res.error.error.code === 'REJECT_LIMIT_REACHED') {
        setFateLocked(true);
        return;
      }
      toast.show({ message: res.error.error.message, tone: 'warning' });
      return;
    }
    setBusy(false);
    await draw();
  }, [deps, draw]);

  const handleAccept = useCallback(async (): Promise<void> => {
    if (!drawn) return;
    setBusy(true);
    const res = await deps.acceptRecommendation({
      recipeId: drawn.option.recipe.id,
      servings: drawn.option.recipe.servings,
    });
    setBusy(false);
    if (res.error) {
      toast.show({ message: 'Пока не работает — скоро', tone: 'warning' });
      return;
    }
    toast.show({ message: 'План создан!', tone: 'success' });
    void router.push(`/shopping/${res.data.shoppingListId}`);
  }, [deps, drawn, router]);

  return (
    <>
      <TabTitle sublabel="Не хотите выбирать?">Рулетка</TabTitle>

      {drawn ? (
        <RouletteCard
          drawn={drawn}
          flipped={flipped}
          acceptBusy={busy}
          fateLocked={fateLocked}
          onFlip={() => setFlipped(true)}
          onAccept={() => void handleAccept()}
          onAnother={() => void handleAnother()}
        />
      ) : (
        <Card className="mb-3" data-testid="roulette-setup">
          <p className="text-body mb-2">Бюджет</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {(['NOTHING', 'MINIMAL', 'NORMAL'] as const).map((mode) => (
              <Chip
                key={mode}
                selected={budget === mode}
                onClick={() => setBudget(mode)}
                data-testid={`roulette-budget-${mode}`}
              >
                {mode === 'NOTHING' ? 'Ничего' : mode === 'MINIMAL' ? 'По минимуму' : 'Обычно'}
              </Chip>
            ))}
          </div>
          <p className="text-body mb-2">Время</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {TIME_CHIPS.map((minutes) => (
              <Chip
                key={minutes}
                selected={maxMinutes === minutes}
                onClick={() => setMaxMinutes(minutes)}
                data-testid={`roulette-time-${minutes}`}
              >
                до {minutes} мин
              </Chip>
            ))}
          </div>
          <Button
            variant="primary"
            className="w-full"
            disabled={busy}
            onClick={() => void draw()}
            data-testid="roulette-spin"
          >
            <Dices size={18} aria-hidden /> Крутить
          </Button>
          {error ? (
            <p
              className="text-caption mt-2 text-[var(--color-danger)]"
              data-testid="roulette-error"
            >
              {error}
            </p>
          ) : null}
        </Card>
      )}

      {drawn ? (
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => setDrawn(null)}
          data-testid="roulette-reset"
        >
          Настроить заново
        </Button>
      ) : null}
    </>
  );
}
