'use client';

// PrepClient — /plan/prep (MC-062): task timeline with checkboxes,
// «одновременно» badge for parallel groups and a header progress bar.
// The done flags persist server-side (PATCH prep-tasks), so progress
// survives reloads (DoD).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Card, Chip } from '@multichef/ui';
import Link from 'next/link';
import type { PrepIntensity, PrepSessionDto } from '@multichef/contracts';
import {
  generatePrepSession as generatePrepSessionApi,
  togglePrepTask as togglePrepTaskApi,
} from '@/lib/prep-client';
import { TabTitle } from '@/components/TabTitle';

export interface PrepClientDeps {
  generatePrepSession: typeof generatePrepSessionApi;
  togglePrepTask: typeof togglePrepTaskApi;
}

// R21 (этап 5): пресеты «Готовить минимум» из идеи — интенсивность
// заготовки, передаваемая в генератор prep-задач.
export const PREP_PRESETS: Array<{
  intensity: PrepIntensity;
  label: string;
  testId: string;
}> = [
  { intensity: 'MINIMAL_15', label: '15 минут', testId: 'prep-preset-minimal15' },
  { intensity: 'COMPONENTS_1H', label: '1 час', testId: 'prep-preset-1h' },
  { intensity: 'BATCH_3H', label: '2–3 часа', testId: 'prep-preset-batch3h' },
  { intensity: 'FULL_WEEK', label: 'Вся неделя', testId: 'prep-preset-fullweek' },
];

const defaultDeps: PrepClientDeps = {
  generatePrepSession: generatePrepSessionApi,
  togglePrepTask: togglePrepTaskApi,
};

export function PrepClient({
  deps: depsOverride,
}: {
  deps?: Partial<PrepClientDeps>;
}): React.ReactElement {
  const deps = useMemo<PrepClientDeps>(() => ({ ...defaultDeps, ...depsOverride }), [depsOverride]);
  const [session, setSession] = useState<PrepSessionDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // R21 (этап 5): пресеты интенсивности из идеи («Готовить минимум»).
  const [intensity, setIntensity] = useState<PrepIntensity>('BATCH_3H');

  const load = useCallback(
    async (intensityValue: PrepIntensity): Promise<void> => {
      setLoading(true);
      const res = await deps.generatePrepSession(intensityValue);
      if (res.error) setError(res.error.error.message);
      else {
        setSession(res.data);
        setError(null);
      }
      setLoading(false);
    },
    [deps],
  );

  useEffect(() => {
    void load('BATCH_3H');
    // начальная загрузка — дефолтная интенсивность
  }, []);

  const toggle = useCallback(
    async (taskId: string, done: boolean): Promise<void> => {
      if (!session) return;
      setSession({
        ...session,
        tasks: session.tasks.map((t) => (t.id === taskId ? { ...t, done } : t)),
      });
      const res = await deps.togglePrepTask(taskId, done);
      if (res.error) {
        setSession({
          ...session,
          tasks: session.tasks.map((t) => (t.id === taskId ? { ...t, done: !done } : t)),
        });
      }
    },
    [deps, session],
  );

  if (loading) {
    return (
      <>
        <TabTitle sublabel="Заготовка">Prep-сессия</TabTitle>
        <Card data-testid="prep-loading">
          <p className="text-body">Загрузка…</p>
        </Card>
      </>
    );
  }

  if (error || !session) {
    return (
      <>
        <TabTitle sublabel="Заготовка">Prep-сессия</TabTitle>
        <Card data-testid="prep-error">
          <p className="text-body">{error ?? 'Активного плана нет — сначала соберите план.'}</p>
        </Card>
      </>
    );
  }

  const doneCount = session.tasks.filter((t) => t.done).length;
  const percent = Math.round((doneCount / Math.max(1, session.tasks.length)) * 100);

  return (
    <>
      <TabTitle sublabel={`Цель: ${session.targetMinutes} мин`}>Заготовка</TabTitle>
      <div className="mb-3 flex flex-wrap gap-2" data-testid="prep-presets">
        {PREP_PRESETS.map((p) => (
          <Chip
            key={p.intensity}
            selected={intensity === p.intensity}
            onClick={() => {
              setIntensity(p.intensity);
              void load(p.intensity);
            }}
            data-testid={`prep-preset-${p.intensity}`}
          >
            {p.label}
          </Chip>
        ))}
      </div>
      <Card className="mb-3" data-testid="prep-progress">
        <div className="flex items-center justify-between">
          <span className="text-body">
            {doneCount} из {session.tasks.length} задач
          </span>
          <Badge tone={percent === 100 ? 'fresh' : 'info'}>{percent}%</Badge>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
          <div
            className="h-full rounded-full bg-[var(--color-primary)]"
            style={{ width: `${percent}%` }}
          />
        </div>
      </Card>

      {session.tasks.map((task) => (
        <Card key={task.id} className="mb-2" data-testid={`prep-task-${task.id}`}>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={task.done}
              onChange={() => void toggle(task.id, !task.done)}
              className="mt-1 h-7 w-7"
              data-testid={`prep-check-${task.id}`}
            />
            <span className="flex-1">
              <span
                className={`flex items-center gap-2 text-body ${task.done ? 'line-through text-[var(--color-text-muted)]' : ''}`}
              >
                {task.title}
                {task.parallelGroup != null ? (
                  <Badge tone="info" data-testid={`prep-parallel-${task.id}`}>
                    одновременно
                  </Badge>
                ) : null}
              </span>
              <span className="text-caption block text-[var(--color-text-muted)]">
                {task.durationMinutes} мин · {task.instructions}
              </span>
            </span>
          </label>
        </Card>
      ))}

      <Card className="mb-6" data-testid="prep-storage-link">
        <Link href="/plan/storage" className="text-sm text-[var(--color-primary)] underline">
          Календарь хранения и разморозки
        </Link>
      </Card>
    </>
  );
}
