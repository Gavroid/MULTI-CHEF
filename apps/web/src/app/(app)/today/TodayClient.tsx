'use client';

// TodayClient — the /today orchestrator (MC-034, viewState 'idle').
//
// The idle view composes Greeting / UrgentBlock / BudgetProgress /
// QuickScenarios / HeroButton / UpcomingMeals / RouletteLink. Wizard,
// loading and result viewStates live on their own sub-routes
// (/today/generate|loading|result) — this component only renders the
// idle screen, per the URL-driven state machine in the ADR.
//
// Data (pantry / preferences / active plan) loads through the shared
// hooks with deps injection for tests. Failures degrade: no pantry →
// empty-state CTA, no profile → empty preferences, no plan → block
// hidden (red flags #2/#9/#11).

import React, { useEffect, useMemo, useState } from 'react';
import { TabTitle } from '@/components/TabTitle';
import { listItems, type PantryItem } from '@/lib/pantry-client';
import { usePantry } from '@/hooks/usePantry';
import { usePreferences } from '@/hooks/usePreferences';
import { getHousehold } from '@/lib/household-client';
import { getActivePlan } from '@/lib/plan-client';
import type { ActivePlanDto } from '@multichef/contracts';
import { Greeting } from './components/Greeting';
import { UrgentBlock, type UrgentItem } from './components/UrgentBlock';
import { BudgetProgress } from './components/BudgetProgress';
import { QuickScenarios } from './components/QuickScenarios';
import { HeroButton } from './components/HeroButton';
import { UpcomingMeals } from './components/UpcomingMeals';
import { RouletteLink } from './components/RouletteLink';

export interface TodayClientDeps {
  listItems: typeof listItems;
  getHousehold: typeof getHousehold;
  getActivePlan: typeof getActivePlan;
}

const defaultDeps: TodayClientDeps = { listItems, getHousehold, getActivePlan };

export interface TodayClientProps {
  deps?: Partial<TodayClientDeps>;
  /** Injected for deterministic tests (Greeting + UrgentBlock). */
  now?: Date;
}

/** Map pantry rows to the UrgentItem view (name = ingredientId for now —
 * the catalogue name join lands with the fridge UI rework). */
function toUrgentItems(items: PantryItem[]): UrgentItem[] {
  return items.map((item) => ({
    id: item.id,
    name: item.notes ?? item.ingredientId,
    expiresAt: item.expiresAt,
  }));
}

/** Audit round-7: UpcomingMeals was previously hardwired to null — the
 * active plan (MC-051) is now the real source. Only entries from today
 * onward are shown, mapped into the component's shape. */
function toUpcomingMeals(plan: ActivePlanDto | null): {
  entries: Array<{ recipeId: string; title: string; scheduledFor: string }>;
} | null {
  if (!plan) return null;
  const todayIso = new Date().toISOString().slice(0, 10);
  const entries = plan.days
    .filter((d) => d.date.slice(0, 10) >= todayIso)
    .flatMap((d) =>
      d.entries.map((e) => ({
        recipeId: e.recipe.id,
        title: e.recipe.title,
        scheduledFor: d.date.slice(0, 10),
      })),
    );
  return { entries };
}

export function TodayClient({ deps: depsOverride, now }: TodayClientProps): React.ReactElement {
  // Memoize the merged deps — a fresh object each render would re-fire
  // the pantry fetch loop (MC-023 lesson).
  const deps = useMemo<TodayClientDeps>(
    () => ({ ...defaultDeps, ...depsOverride }),
    [depsOverride],
  );
  const pantry = usePantry({ listItems: deps.listItems });
  // Audit round-5: the weekly budget comes from the household record
  // (filled by onboarding registration or PATCH /household).
  const [budgetWeekKopecks, setBudgetWeekKopecks] = useState<number | null>(null);
  const [activePlan, setActivePlan] = useState<ActivePlanDto | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void deps
      .getActivePlan()
      .then((res) => {
        if (cancelled) return;
        // T48-D: без плана (404 PLAN_NOT_FOUND) показываем пустое
        // состояние; skeletons — только до первого ответа.
        setLoadingPlan(false);
        if (res.error) return;
        setActivePlan(res.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [deps]);
  useEffect(() => {
    let cancelled = false;
    void deps
      .getHousehold()
      .then((res) => {
        if (cancelled || res.error) return;
        setBudgetWeekKopecks(res.data.budgetWeekKopecks ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [deps]);
  // Preferences feed BudgetProgress/urgent logic in later milestones
  // (MC-040+); the hook is mounted here so the 60s cache warms early
  // and failures degrade silently (manager default #2).
  usePreferences();

  if (loadingPlan) {
    // T48-D (audit round 48): skeleton вместо silent empty-then-fill.
    return (
      <>
        <TabTitle sublabel="Главный экран">Сегодня</TabTitle>
        <Greeting {...(now ? { now } : {})} />
        <div className="flex flex-col gap-3" data-testid="today-skeleton" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <TabTitle sublabel="Главный экран">Сегодня</TabTitle>
      <Greeting {...(now ? { now } : {})} />
      <UrgentBlock items={toUrgentItems(pantry.items)} {...(now ? { now } : {})} />
      <BudgetProgress budgetWeekKopecks={budgetWeekKopecks} />
      <HeroButton pantrySize={pantry.items.length} />
      <QuickScenarios />
      <UpcomingMeals activePlan={toUpcomingMeals(activePlan)} />
      <RouletteLink />
    </>
  );
}
