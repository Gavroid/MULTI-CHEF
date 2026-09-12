'use client';

// WizardClient — 3-step recommendation wizard (MC-034, PRD §2.3.3).
//
// Steps: budget (radio) → time (slider) → anti-filters (checkboxes).
// Each step validates with Zod before «Далее»; «Назад» moves back.
// Quick-scenario prefill arrives via ?prefill= and can skip the budget
// step entirely (NOTHING, URGENT) per the ADR transition table.
//
// Submit («Получить рекомендацию») pushes /today/loading with the
// settings in the query string; LoadingClient performs the POST.

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Carrot,
  Clock,
  CookingPot,
  Flame,
  Hourglass,
  Repeat,
  ShoppingBag,
  Snowflake,
  Wallet,
} from 'lucide-react';
import { Button, Card } from '@multichef/ui';
import type { AntiFilter, BudgetMode } from '@multichef/contracts';
import { TabTitle } from '@/components/TabTitle';
import BudgetStep from './components/BudgetStep';
import TimeStep from './components/TimeStep';
import AntiRecipesStep from './components/AntiRecipesStep';

export interface WizardState {
  step: 'budget' | 'time' | 'anti';
  budgetMode: BudgetMode;
  maxMinutes: number;
  antiFilters: AntiFilter[];
}

export interface WizardPrefill {
  budgetMode?: BudgetMode;
  maxMinutes?: number;
  antiFilters?: AntiFilter[];
  /** URGENT expands to MINIMAL / 20 / [SHORT_TIME, NO_MULTISTEP] (manager decision #3). */
  urgent?: boolean;
}

export const URGENT_SETTINGS = {
  budgetMode: 'MINIMAL' as BudgetMode,
  maxMinutes: 20,
  antiFilters: ['SHORT_TIME', 'NO_MULTISTEP'] as AntiFilter[],
};

/**
 * Parse the ?prefill= payload. Unknown tokens are ignored (red flag #7).
 * Grammar: BUDGET | .MINUTES. | ..ANTI[,ANTI] | URGENT — the chips on
 * /today emit exactly one token each.
 */
export function parsePrefill(raw: string | null): WizardPrefill {
  if (!raw) return {};
  if (raw === 'URGENT') {
    return { urgent: true, ...URGENT_SETTINGS };
  }
  const parts = raw.split('.');
  const prefill: WizardPrefill = {};
  const [budget, minutes, anti] = parts;
  if (budget && ['NOTHING', 'MINIMAL', 'NORMAL'].includes(budget)) {
    prefill.budgetMode = budget as BudgetMode;
  }
  if (minutes) {
    const n = Number.parseInt(minutes, 10);
    if (Number.isFinite(n) && n >= 15 && n <= 120) prefill.maxMinutes = n;
  }
  if (anti) {
    const ALL = [
      'NO_OVEN',
      'ONE_PAN',
      'NOT_CHICKEN_AGAIN',
      'NO_LEFTOVERS',
      'NO_FRYING',
      'NO_CHOPPING',
      'SHORT_TIME',
      'NO_MULTISTEP',
    ];
    const filters = anti.split(',').filter((token) => ALL.includes(token)) as AntiFilter[];
    if (filters.length > 0) prefill.antiFilters = filters;
  }
  return prefill;
}

export function initialState(prefill: WizardPrefill = {}): WizardState {
  // NOTHING (and URGENT) skip the budget step — start on `time`.
  const skipBudget = prefill.budgetMode === 'NOTHING' || prefill.urgent === true;
  return {
    step: skipBudget ? 'time' : 'budget',
    budgetMode: prefill.budgetMode ?? (prefill.urgent ? 'MINIMAL' : 'NORMAL'),
    maxMinutes: prefill.maxMinutes ?? 60,
    antiFilters: prefill.antiFilters ?? [],
  };
}

export interface WizardClientProps {
  /** Raw ?prefill= from the URL. */
  prefill?: string | null;
  onSubmit?: (settings: {
    budgetMode: BudgetMode;
    maxMinutes: number;
    antiFilters: AntiFilter[];
  }) => void;
}

const STEP_ORDER: WizardState['step'][] = ['budget', 'time', 'anti'];
const STEP_LABELS: Record<WizardState['step'], string> = {
  budget: 'Бюджет',
  time: 'Время',
  anti: 'Антирецепты',
};

export function WizardClient({ prefill, onSubmit }: WizardClientProps): React.ReactElement {
  const router = useRouter();
  const prefillMemo = useMemo(() => parsePrefill(prefill ?? null), [prefill]);
  const [state, setState] = useState<WizardState>(() => initialState(prefillMemo));
  const stepIndex = STEP_ORDER.indexOf(state.step);

  const goTo = (step: WizardState['step']): void => setState((s) => ({ ...s, step }));

  const handleSubmit = (): void => {
    const settings = {
      budgetMode: state.budgetMode,
      maxMinutes: state.maxMinutes,
      antiFilters: state.antiFilters,
    };
    if (onSubmit) {
      onSubmit(settings);
      return;
    }
    const params = new URLSearchParams({
      budget: settings.budgetMode,
      time: String(settings.maxMinutes),
      anti: settings.antiFilters.join(','),
    });
    router.push(`/today/loading?${params.toString()}`);
  };

  return (
    <>
      <TabTitle sublabel="Новая рекомендация">Мастер</TabTitle>

      <p className="mb-2 text-xs text-[var(--color-text-muted)]" data-testid="wizard-progress">
        Шаг {stepIndex + 1} из 3 · {STEP_LABELS[state.step]}
      </p>
      <div className="mb-4 flex gap-1" data-testid="wizard-dots" aria-hidden>
        {STEP_ORDER.map((s, i) => (
          <span
            key={s}
            className={
              i < stepIndex
                ? 'h-1.5 flex-1 rounded-full bg-[var(--color-primary)]'
                : i === stepIndex
                  ? 'h-1.5 flex-1 rounded-full bg-[var(--color-primary-soft)]'
                  : 'h-1.5 flex-1 rounded-full bg-[var(--color-surface-2)]'
            }
          />
        ))}
      </div>

      {state.step === 'budget' ? (
        <BudgetStep
          value={state.budgetMode}
          onChange={(budgetMode) => setState((s) => ({ ...s, budgetMode }))}
          onNext={() => goTo('time')}
        />
      ) : null}
      {state.step === 'time' ? (
        <TimeStep
          value={state.maxMinutes}
          onChange={(maxMinutes) => setState((s) => ({ ...s, maxMinutes }))}
          onBack={() => goTo('budget')}
          onNext={() => goTo('anti')}
        />
      ) : null}
      {state.step === 'anti' ? (
        <AntiRecipesStep
          selected={state.antiFilters}
          onChange={(antiFilters) => setState((s) => ({ ...s, antiFilters }))}
          onBack={() => goTo('time')}
          onSubmit={handleSubmit}
        />
      ) : null}
    </>
  );
}

// Re-exported so step components and tests share one icon set.
export const WIZARD_ICONS = {
  ArrowLeft,
  ArrowRight,
  Ban,
  Carrot,
  Clock,
  CookingPot,
  Flame,
  Hourglass,
  Repeat,
  ShoppingBag,
  Snowflake,
  Wallet,
  Button,
  Card,
};
