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
}

const defaultDeps: TodayClientDeps = { listItems, getHousehold };

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

  return (
    <>
      <TabTitle sublabel="Главный экран">Сегодня</TabTitle>
      <Greeting {...(now ? { now } : {})} />
      <UrgentBlock items={toUrgentItems(pantry.items)} {...(now ? { now } : {})} />
      <BudgetProgress budgetWeekKopecks={budgetWeekKopecks} />
      <HeroButton pantrySize={pantry.items.length} />
      <QuickScenarios />
      <UpcomingMeals activePlan={null} />
      <RouletteLink />
    </>
  );
}
