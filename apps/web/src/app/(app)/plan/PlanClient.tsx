'use client';

// PlanClient — /plan «План» tab (MC-055, PRD §2.3.10).
//
// Renders the household's ACTIVE weekly plan: day cards with meal
// entries and a daily-calories progress bar vs the person target.
// Empty state deep-links to /plan/setup. Data loads client-side via
// the shared hooks pattern (deps injectable for tests).

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, Card, Skeleton } from '@multichef/ui';
import type { ActivePlanDto } from '@multichef/contracts';
import { getActivePlan, type PlanClientDeps } from '@/lib/plan-client';
import { TabTitle } from '@/components/TabTitle';

export const DEFAULT_DAILY_TARGET = 2000;

/** Percent (0..110 capped) of the daily target consumed by a day. */
export function kcalPercent(totalCalories: number, target = DEFAULT_DAILY_TARGET): number {
  if (target <= 0) return 0;
  return Math.min(110, Math.round((totalCalories / target) * 100));
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

  useEffect(() => {
    let cancelled = false;
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
  }, [deps]);

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
          <Link href="/plan/setup" className="text-sm text-[var(--color-primary)] underline">
            Сгенерировать план
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
          <Button variant="primary" data-testid="plan-setup-cta">
            <Link href="/plan/setup">Собрать план</Link>
          </Button>
        </Card>
      </>
    );
  }

  return (
    <>
      <TabTitle sublabel={`${plan.days.length} дней · на ${plan.peopleCount} чел.`}>
        План недели
      </TabTitle>
      <div className="flex flex-col gap-3" data-testid="plan-days">
        {plan.days.map((day) => {
          const percent = kcalPercent(day.totalCalories);
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
                  {Math.round(day.totalCalories)} ккал/день
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
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {mealLabel(entry.mealType)} · {Math.round(entry.servings)} порц.
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
      <Card className="mb-6" data-testid="plan-regenerate">
        <Link href="/plan/setup">
          <Button variant="secondary" className="w-full">
            Пересобрать план
          </Button>
        </Link>
      </Card>
    </>
  );
}
