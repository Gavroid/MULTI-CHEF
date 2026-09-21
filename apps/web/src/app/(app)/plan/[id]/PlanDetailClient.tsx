'use client';

// PlanDetailClient — /plan/[id] (PRD §2.3.10, R17-WP4).
//
// Detail view for a specific plan (not just active). Loads
// GET /api/v1/meal-plans/:id via getMealPlan (plan-client).
// Reuses the same rendering logic as PlanClient — day carousel +
// meal cards with КБЖУ. Bottom tabs link to /plan/[id]/prep and
// /plan/[id]/storage (existing /plan/prep and /plan/storage aliases).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, Chip, Skeleton, toast } from '@multichef/ui';
import type { ActivePlanDto } from '@multichef/contracts';
import { getMealPlan, replaceMealPlan, type PlanClientDeps } from '@/lib/plan-client';
import { TabTitle } from '@/components/TabTitle';

const MEAL_LABELS: Record<string, string> = {
  BREAKFAST: 'Завтрак',
  LUNCH: 'Обед',
  DINNER: 'Ужин',
  SNACK: 'Перекус',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  GENERATING: 'Генерируется',
  ACTIVE: 'Активный',
  COMPLETED: 'Завершён',
  ARCHIVED: 'В архиве',
};

export interface PlanDetailClientProps {
  planId: string;
  deps?: Partial<PlanClientDeps>;
}

export function PlanDetailClient({
  planId,
  deps: depsOverride,
}: PlanDetailClientProps): React.ReactElement {
  const deps = useMemo<PlanClientDeps>(() => ({ ...depsOverride }), [depsOverride]);

  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<ActivePlanDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getMealPlan(planId, deps).then((res) => {
      if (cancelled) return;
      if (res.error) {
        setError(res.error.error.message);
        setLoading(false);
        return;
      }
      setPlan(res.data);
      if (res.data && res.data.days.length > 0) {
        setSelectedDay(res.data.days[0]?.id ?? null);
      }
      setLoading(false);
    });
    return (): void => {
      cancelled = true;
    };
  }, [planId, deps]);

  const onReplaceMeal = useCallback(
    async (entryId: string): Promise<void> => {
      const res = await replaceMealPlan(entryId, deps);
      if (res.error) {
        toast.danger('Не удалось заменить блюдо');
        return;
      }
      // refetch
      const refresh = await getMealPlan(planId, deps);
      if (!refresh.error) setPlan(refresh.data);
      toast.success('Замена запущена');
    },
    [deps, planId],
  );

  if (loading) {
    return (
      <>
        <TabTitle>План</TabTitle>
        <Card>
          <Skeleton className="h-4 w-2/3 mb-2" />
          <Skeleton className="h-4 w-1/2" />
        </Card>
      </>
    );
  }

  if (error || !plan) {
    return (
      <>
        <TabTitle>План</TabTitle>
        <Card>
          <p className="text-body text-[var(--color-danger)]" role="alert">
            {error ?? 'План не найден'}
          </p>
          <Link href="/plan" className="mt-2 inline-block text-body text-[var(--color-primary)]">
            ← К текущему плану
          </Link>
        </Card>
      </>
    );
  }

  const currentDay = plan.days.find((d) => d.id === selectedDay) ?? plan.days[0];

  return (
    <div className="flex flex-col gap-4" data-testid="plan-detail-page">
      <Link href="/plan" className="text-body text-[var(--color-text-muted)]">
        ← К плану
      </Link>

      <Card>
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-title">План #{plan.id.slice(-6)}</h1>
          <Chip
            selected
            data-testid="plan-detail-status"
            aria-label={STATUS_LABELS[plan.status] ?? plan.status}
          >
            {STATUS_LABELS[plan.status] ?? plan.status}
          </Chip>
        </div>
        <p className="text-body text-[var(--color-text-muted)]">
          {plan.startDate} — {plan.endDate} · {plan.peopleCount} чел.
        </p>
      </Card>

      {/* Bottom tabs — links to existing /plan/prep and /plan/storage. */}
      <Card>
        <div className="flex flex-wrap gap-2 mb-3" role="tablist" aria-label="Разделы плана">
          <Chip selected aria-label="Меню">
            Меню
          </Chip>
          <Link
            href="/plan/prep"
            className="h-10 inline-flex items-center px-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] text-body"
          >
            Заготовка
          </Link>
          <Link
            href="/plan/storage"
            className="h-10 inline-flex items-center px-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] text-body"
          >
            Хранение
          </Link>
        </div>
      </Card>

      {/* Day selector */}
      <Card>
        <div className="flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Дни плана">
          {plan.days.map((d) => (
            <button
              key={d.id}
              type="button"
              role="tab"
              aria-selected={selectedDay === d.id}
              onClick={() => setSelectedDay(d.id)}
              className={`flex-shrink-0 h-12 min-w-[80px] px-3 rounded-md border ${
                selectedDay === d.id
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-body-strong'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] text-body'
              }`}
              data-testid={`plan-day-${d.id}`}
            >
              {d.date}
            </button>
          ))}
        </div>
      </Card>

      {/* Meals for the selected day */}
      {currentDay ? (
        <Card>
          <h2 className="text-heading mb-2">День {currentDay.date}</h2>
          <p className="text-body text-[var(--color-text-muted)] mb-3">
            {currentDay.totalCalories} ккал · Б {currentDay.totalProteinG} · Ж{' '}
            {currentDay.totalFatG} · У {currentDay.totalCarbsG}
          </p>
          {currentDay.entries.length === 0 ? (
            <p className="text-body">Нет блюд на этот день.</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="plan-detail-entries">
              {currentDay.entries.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between border-b border-[var(--color-border)] pb-2"
                  data-testid={`plan-entry-${e.id}`}
                >
                  <Link href={`/recipe/${e.recipe.id}`} className="flex flex-col">
                    <span className="text-body-strong">{e.recipe.title}</span>
                    <span className="text-caption text-[var(--color-text-muted)]">
                      {MEAL_LABELS[e.mealType] ?? e.mealType} · {e.portionGrams} г
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => void onReplaceMeal(e.id)}
                    className="h-10 px-3 rounded-md border border-[var(--color-border)] text-body"
                    data-testid={`plan-entry-replace-${e.id}`}
                  >
                    Заменить
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
