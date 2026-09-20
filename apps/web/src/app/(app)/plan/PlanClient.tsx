'use client';

// PlanClient — /plan «План» tab (MC-055, PRD §2.3.10).
//
// Renders the household's ACTIVE weekly plan: day cards with meal
// entries and a daily-calories progress bar vs the person target.
// Empty state deep-links to /plan/setup. Data loads client-side via
// the shared hooks pattern (deps injectable for tests).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, Skeleton } from '@multichef/ui';
import type { ActivePlanDto } from '@multichef/contracts';
import { getActivePlan, getJob, replaceMealPlan, type PlanClientDeps } from '@/lib/plan-client';
import { TabTitle } from '@/components/TabTitle';

export const DEFAULT_DAILY_TARGET = 2000;

/** Percent (0..110 capped) of the daily target consumed by a day. */
export function kcalPercent(
  totalCalories: number,
  target = DEFAULT_DAILY_TARGET,
  peopleCount = 1,
): number {
  if (target <= 0) return 0;
  const perPerson = totalCalories / Math.max(1, peopleCount);
  return Math.min(110, Math.round((perPerson / target) * 100));
}

const MEAL_LABELS: Record<string, string> = {
  BREAKFAST: 'Завтрак',
  LUNCH: 'Обед',
  DINNER: 'Ужин',
  SNACK: 'Перекус',
};

export function mealLabel(mealType: string): string {
  return MEAL_LABELS[mealType] ?? mealType;
}

export interface PlanClientProps {
  deps?: Partial<PlanClientDeps>;
}

export function PlanClient({ deps: depsOverride }: PlanClientProps): React.ReactElement {
  const deps = useMemo(
    () => ({
      getActivePlan,
      ...depsOverride,
    }),
    [depsOverride],
  );
  const [plan, setPlan] = useState<ActivePlanDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [replacingId, setReplacingId] = useState<string | null>(null);

  // R21 (этап 1): заменить блюдо — джоба REPLACE_MEAL, затем перезагрузка плана.
  const replaceEntry = useCallback(async (entryId: string): Promise<void> => {
    setReplacingId(entryId);
    const res = await replaceMealPlan(entryId);
    if (res.error) {
      setReplacingId(null);
      return;
    }
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const jr = await getJob(res.data.jobId);
      if (jr.error) break;
      if (jr.data.status === 'COMPLETED' || jr.data.status === 'FAILED') break;
    }
    setReplacingId(null);
    window.location.reload();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void retryNonce;
    void deps
      .getActivePlan()
      .then((res) => {
        if (cancelled) return;
        if (res.error) setError(res.error.error.message);
        else setPlan(res.data);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Не удалось загрузить план');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [deps, retryNonce]);

  if (loading) {
    return (
      <>
        <TabTitle sublabel="Недельное меню">План</TabTitle>
        <div className="mb-3 flex flex-col gap-3" data-testid="plan-loading">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <TabTitle sublabel="Недельное меню">План</TabTitle>
        <Card data-testid="plan-error">
          <p className="text-body">{error}</p>
          <button
            type="button"
            className="mt-4 rounded-md bg-[var(--color-primary)] px-4 py-2 text-white disabled:opacity-50"
            disabled={retrying}
            onClick={() => {
              setRetrying(true);
              setRetryNonce((n) => n + 1);
              void deps
                .getActivePlan()
                .then((res) => {
                  if (res.error) {
                    setError(res.error.error.message);
                  } else {
                    setError(null);
                    setPlan(res.data);
                  }
                })
                .finally(() => setRetrying(false));
            }}
          >
            {retrying ? 'Повторяем…' : 'Повторить'}
          </button>
          <Link href="/plan/setup" className="ml-3 text-sm text-[var(--color-primary)] underline">
            Сгенерировать заново
          </Link>
        </Card>
      </>
    );
  }

  if (!plan) {
    return (
      <>
        <TabTitle sublabel="Недельное меню">План</TabTitle>
        <Card className="mb-4" data-testid="plan-empty">
          <p className="text-body mb-3">
            Активного плана пока нет. Соберите неделю из того, что есть в холодильнике.
          </p>
          {/* Audit round-4: a <Link> inside <Button> is invalid HTML
              (nested interactive elements) — link styled as the CTA. */}
          <Link
            href="/plan/setup"
            className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-base font-semibold text-white hover:bg-[var(--color-primary-press)]"
            data-testid="plan-setup-cta"
          >
            Собрать план
          </Link>
        </Card>
      </>
    );
  }

  return (
    <>
      <TabTitle sublabel={`${plan.days.length} дней · на ${plan.peopleCount} чел.`}>
        План недели
      </TabTitle>
      <div
        className="grid grid-cols-1 gap-3 md:grid-cols-2 md:items-start lg:grid-cols-3"
        data-testid="plan-days"
      >
        {plan.days.map((day) => {
          const percent = kcalPercent(day.totalCalories, DEFAULT_DAILY_TARGET, plan.peopleCount);
          return (
            <Card key={day.id} data-testid="plan-day">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-title">
                  {new Date(day.date).toLocaleDateString('ru-RU', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}
                </h3>
                <span className="text-caption text-[var(--color-text-muted)]">
                  {Math.round(day.totalCalories / Math.max(1, plan.peopleCount))} ккал/день/чел.
                </span>
              </div>
              <div
                className="mb-3 h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]"
                role="progressbar"
                aria-valuenow={percent}
                data-testid="plan-day-bar"
              >
                <div
                  className="h-full rounded-full bg-[var(--color-primary)]"
                  style={{ width: `${Math.min(100, percent)}%` }}
                />
              </div>
              <ul className="flex flex-col gap-1">
                {day.entries.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between text-sm">
                    <Link
                      href={`/recipe/${entry.recipe.id}?servings=${Math.round(entry.servings)}`}
                      className="text-[var(--color-text)] underline-offset-2 hover:underline"
                    >
                      {entry.recipe.title}
                    </Link>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {mealLabel(entry.mealType)} · {Math.round(entry.servings)} порц.
                      </span>
                      <button
                        type="button"
                        disabled={replacingId !== null}
                        onClick={() => void replaceEntry(entry.id)}
                        className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-primary)] disabled:opacity-50"
                        data-testid={`plan-replace-${entry.id}`}
                        aria-label="Заменить блюдо"
                      >
                        ⇄
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
      {plan.days.length > 0 ? (
        <Card className="mb-6" data-testid="plan-week-summary">
          <h3 className="text-title mb-2">Итог недели</h3>
          {(() => {
            const n = Math.max(1, plan.days.length);
            const sum = (sel: (d: ActivePlanDto['days'][number]) => number): number =>
              plan.days.reduce((acc, d) => acc + sel(d), 0);
            const avgKcal = Math.round(sum((d) => d.totalCalories) / n);
            const avgP = Math.round(sum((d) => d.totalProteinG) / n);
            const avgF = Math.round(sum((d) => d.totalFatG) / n);
            const avgC = Math.round(sum((d) => d.totalCarbsG) / n);
            const deviation = avgKcal - DEFAULT_DAILY_TARGET;
            const deviationLabel =
              Math.abs(deviation) <= 100
                ? 'в пределах цели'
                : deviation > 0
                  ? `выше цели на ${deviation} ккал`
                  : `ниже цели на ${Math.abs(deviation)} ккал`;
            const proteinHint =
              avgP < 90
                ? ' · белка маловато: добавьте творог, курицу или рыбу'
                : avgP > 150
                  ? ' · белка с избытком — можно заменить часть мясного гарниром'
                  : '';
            return (
              <p className="text-body" data-testid="plan-week-averages">
                В среднем за день: {avgKcal} ккал · Б {avgP} г · Ж {avgF} г · У {avgC} г —{' '}
                {deviationLabel}.{proteinHint}
              </p>
            );
          })()}
        </Card>
      ) : null}

      <Card className="mb-6" data-testid="plan-regenerate">
        <Link
          href="/plan/setup"
          className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border-[1.5px] border-[var(--color-border)] bg-transparent px-4 py-3 text-base font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
        >
          Пересобрать план
        </Link>
      </Card>
    </>
  );
}
