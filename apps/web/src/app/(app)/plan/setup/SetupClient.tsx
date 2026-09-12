'use client';

// SetupClient — /plan/setup wizard (MC-055, PRD §2.3.11).
//
// 3 compact steps: household (people/days) → shape (meals/no-cook
// days) → goals (budget/calories) → POST /meal-plans → job progress
// polling (1.5 s) → router.push('/plan') when the plan is COMPLETED.

import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Chip, Input, toast } from '@multichef/ui';
import type { JobDto, MealPlanSetupDto } from '@multichef/contracts';
import { createMealPlan as createMealPlanApi, getJob as getJobApi } from '@/lib/plan-client';
import { TabTitle } from '@/components/TabTitle';

export interface WizardState {
  step: 1 | 2 | 3;
  peopleCount: number;
  days: number;
  mealsPerDay: number;
  noCookDays: number[];
  targetBudgetKopecks: number | null;
  targetDailyCalories: number | null;
}

export const initialState: WizardState = {
  step: 1,
  peopleCount: 2,
  days: 7,
  mealsPerDay: 3,
  noCookDays: [],
  targetBudgetKopecks: null,
  targetDailyCalories: null,
};

export function toSetup(state: WizardState): Partial<MealPlanSetupDto> {
  return {
    peopleCount: state.peopleCount,
    days: state.days,
    mealsPerDay: state.mealsPerDay,
    noCookDays: state.noCookDays,
    ...(state.targetBudgetKopecks ? { targetBudgetKopecks: state.targetBudgetKopecks } : {}),
    ...(state.targetDailyCalories ? { targetDailyCalories: state.targetDailyCalories } : {}),
  };
}

const STAGE_LABELS: Record<string, string> = {
  queued: 'В очереди…',
  filtering: 'Отбираем рецепты…',
  scoring: 'Оцениваем варианты…',
  optimizing: 'Собираем неделю…',
  'building-list': 'Формируем список покупок…',
  done: 'Готово!',
};

export function stageLabel(stage: string | null): string {
  return STAGE_LABELS[stage ?? 'queued'] ?? 'Работаем…';
}

export interface SetupClientDeps {
  createMealPlan: typeof createMealPlanApi;
  getJob: typeof getJobApi;
}

const defaultDeps: SetupClientDeps = { createMealPlan: createMealPlanApi, getJob: getJobApi };

export function SetupClient({
  deps: depsOverride,
}: {
  deps?: Partial<SetupClientDeps>;
}): React.ReactElement {
  const deps = useMemo<SetupClientDeps>(
    () => ({ ...defaultDeps, ...depsOverride }),
    [depsOverride],
  );
  const router = useRouter();
  const [state, setState] = useState<WizardState>(initialState);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobDto | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (partial: Partial<WizardState>): void => setState((s) => ({ ...s, ...partial }));

  const toggleNoCook = useCallback((day: number): void => {
    setState((s) => ({
      ...s,
      noCookDays: s.noCookDays.includes(day)
        ? s.noCookDays.filter((d) => d !== day)
        : [...s.noCookDays, day].sort((a, b) => a - b),
    }));
  }, []);

  // Job progress polling: every 1.5 s until COMPLETED/FAILED.
  const poll = useCallback(
    async (id: string): Promise<void> => {
      const res = await deps.getJob(id);
      if (res.error) {
        setTimeout(() => void poll(id), 1500);
        return;
      }
      setJob(res.data);
      if (res.data.status === 'COMPLETED') {
        toast.show({ message: 'План готов!', tone: 'success' });
        void router.push('/plan');
        return;
      }
      if (res.data.status === 'FAILED') {
        toast.show({ message: 'Не удалось собрать план', tone: 'warning' });
        setJobId(null);
        return;
      }
      setTimeout(() => void poll(id), 1500);
    },
    [deps, router],
  );

  const startPolling = useCallback(
    (id: string): void => {
      setJob({
        id,
        type: 'GENERATE_PLAN',
        status: 'QUEUED',
        progress: 0,
        stage: 'queued',
        resultRef: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setTimeout(() => void poll(id), 600);
    },
    [poll],
  );

  const submit = useCallback(async (): Promise<void> => {
    setBusy(true);
    const res = await deps.createMealPlan(toSetup(state));
    setBusy(false);
    if (res.error) {
      toast.show({ message: res.error.error.message, tone: 'warning' });
      return;
    }
    setJobId(res.data.jobId);
    startPolling(res.data.jobId);
  }, [deps, state, startPolling]);

  if (jobId) {
    const percent = job?.progress ?? 0;
    return (
      <>
        <TabTitle sublabel="Собираем ваше меню">План на неделю</TabTitle>
        <Card className="py-10 text-center" data-testid="setup-progress">
          <p className="text-title mb-2">{stageLabel(job?.stage ?? 'queued')}</p>
          <div
            className="mx-auto h-2 w-2/3 overflow-hidden rounded-full bg-[var(--color-surface-2)]"
            role="progressbar"
            aria-valuenow={percent}
            data-testid="setup-progress-bar"
          >
            <div
              className="h-full rounded-full bg-[var(--color-primary)] transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-caption mt-3 text-[var(--color-text-muted)]">
            Можно закрыть страницу — план появится во вкладке «План».
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
      <TabTitle sublabel={`Шаг ${state.step} из 3`}>Собрать план</TabTitle>
      <Card className="mb-3" data-testid={`setup-step-${state.step}`}>
        {state.step === 1 ? (
          <>
            <p className="text-body mb-2">Сколько человек?</p>
            <Input
              type="number"
              min={1}
              max={12}
              value={state.peopleCount}
              onChange={(e) =>
                patch({ peopleCount: Math.max(1, Number.parseInt(e.target.value, 10) || 1) })
              }
              data-testid="setup-people"
            />
            <p className="text-body mt-4 mb-2">Сколько дней планируем?</p>
            <div className="flex flex-wrap gap-2">
              {[3, 5, 7].map((d) => (
                <Chip
                  key={d}
                  selected={state.days === d}
                  onClick={() => patch({ days: d })}
                  data-testid={`setup-days-${d}`}
                >
                  {d} дней
                </Chip>
              ))}
            </div>
          </>
        ) : null}

        {state.step === 2 ? (
          <>
            <p className="text-body mb-2">Приёмов пищи в день</p>
            <div className="mb-4 flex flex-wrap gap-2">
              {[2, 3, 4].map((m) => (
                <Chip
                  key={m}
                  selected={state.mealsPerDay === m}
                  onClick={() => patch({ mealsPerDay: m })}
                  data-testid={`setup-meals-${m}`}
                >
                  {m}
                </Chip>
              ))}
            </div>
            <p className="text-body mb-2">Дни без готовки (сборные блюда)</p>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: state.days }, (_, i) => (
                <Chip
                  key={i}
                  selected={state.noCookDays.includes(i)}
                  onClick={() => toggleNoCook(i)}
                  data-testid={`setup-nocook-${i}`}
                >
                  День {i + 1}
                </Chip>
              ))}
            </div>
          </>
        ) : null}

        {state.step === 3 ? (
          <>
            <p className="text-body mb-2">Бюджет на неделю, ₽ (необязательно)</p>
            <Input
              type="number"
              min={0}
              placeholder="Например, 3000"
              value={state.targetBudgetKopecks ? state.targetBudgetKopecks / 100 : ''}
              onChange={(e) => {
                const roubles = Number.parseInt(e.target.value, 10);
                patch({ targetBudgetKopecks: Number.isFinite(roubles) ? roubles * 100 : null });
              }}
              data-testid="setup-budget"
            />
            <p className="text-body mt-4 mb-2">Калории в день на человека (необязательно)</p>
            <Input
              type="number"
              min={500}
              max={6000}
              placeholder="Например, 2000"
              value={state.targetDailyCalories ?? ''}
              onChange={(e) => {
                const kcal = Number.parseInt(e.target.value, 10);
                patch({ targetDailyCalories: Number.isFinite(kcal) ? kcal : null });
              }}
              data-testid="setup-calories"
            />
          </>
        ) : null}
      </Card>

      <div className="mb-6 flex gap-2">
        {state.step > 1 ? (
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => patch({ step: (state.step - 1) as 1 | 2 })}
            data-testid="setup-back"
          >
            Назад
          </Button>
        ) : null}
        {state.step < 3 ? (
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => patch({ step: (state.step + 1) as 2 | 3 })}
            data-testid="setup-next"
          >
            Далее
          </Button>
        ) : (
          <Button
            variant="primary"
            className="flex-1"
            disabled={busy}
            onClick={() => void submit()}
            data-testid="setup-submit"
          >
            Собрать план
          </Button>
        )}
      </div>
    </>
  );
}
