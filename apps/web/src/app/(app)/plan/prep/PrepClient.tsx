'use client';

// PrepClient — /plan/prep (MC-062): task timeline with checkboxes,
// «одновременно» badge for parallel groups and a header progress bar.
// The done flags persist server-side (PATCH prep-tasks), so progress
// survives reloads (DoD).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Card } from '@multichef/ui';
import Link from 'next/link';
import type { PrepSessionDto } from '@multichef/contracts';
import {
  generatePrepSession as generatePrepSessionApi,
  togglePrepTask as togglePrepTaskApi,
} from '@/lib/prep-client';
import { TabTitle } from '@/components/TabTitle';

export interface PrepClientDeps {
  generatePrepSession: typeof generatePrepSessionApi;
  togglePrepTask: typeof togglePrepTaskApi;
}

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

  const load = useCallback(async (): Promise<void> => {
    const res = await deps.generatePrepSession('BATCH_3H');
    if (res.error) setError(res.error.error.message);
    else setSession(res.data);
    setLoading(false);
  }, [deps]);

  useEffect(() => {
    void load();
  }, [load]);

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
