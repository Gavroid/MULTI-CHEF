'use client';

// LoadingClient — /today/loading (MC-034, PRD §2.3.3 loading screen).
//
// Fires POST /recommendations/today on mount (settings from the
// ?budget=&time=&anti= query) and runs an OPTICAL progress animation
// in parallel (manager default #4): whichever finishes first wins.
// POST fast (<~200ms of animation) → redirect immediately; POST slow →
// the animation cycles through its stages while we wait. Result goes
// to sessionStorage under ?ref=<uuid>; redirect to /today/result?ref=.
//
// Failure: toast + «Повторить» re-fires the POST (red flag: back nav
// double-POST is prevented by the resultRef short-circuit below).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { Button, Card } from '@multichef/ui';
import {
  getRecommendationsToday,
  type GenerationSettings,
} from '@/lib/recommendations-client';
import type { AntiFilter, BudgetMode, TodayRecommendationDto } from '@multichef/contracts';
import { TabTitle } from '@/components/TabTitle';

export const RESULT_TTL_MS = 30 * 60_000;

export interface SessionResult {
  result: TodayRecommendationDto;
  settings: GenerationSettings;
  createdAt: number;
}

export function saveSessionResult(
  result: SessionResult,
  sessionStorageImpl: Storage = window.sessionStorage,
): string {
  const ref =
    globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  sessionStorageImpl.setItem(`mc-result-${ref}`, JSON.stringify(result));
  return ref;
}

export function loadSessionResult(
  ref: string | null,
  sessionStorageImpl: Storage = window.sessionStorage,
): SessionResult | null {
  if (!ref) return null;
  const raw = sessionStorageImpl.getItem(`mc-result-${ref}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionResult;
    if (Date.now() - parsed.createdAt > RESULT_TTL_MS) {
      sessionStorageImpl.removeItem(`mc-result-${ref}`);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export interface LoadingClientDeps {
  fetchRecommendations: typeof getRecommendationsToday;
}

const defaultDeps: LoadingClientDeps = { fetchRecommendations: getRecommendationsToday };

export interface LoadingClientProps {
  deps?: Partial<LoadingClientDeps>;
}

const STAGES = [
  { untilMs: 200, label: 'Загружаем продукты…' },
  { untilMs: 350, label: 'Исключаем аллергены…' },
  { untilMs: Number.POSITIVE_INFINITY, label: 'Считаем рекомендации…' },
];

function parseSettings(
  budget: string | null,
  time: string | null,
  anti: string | null,
): GenerationSettings {
  const settings: GenerationSettings = {};
  if (budget && ['NOTHING', 'MINIMAL', 'NORMAL'].includes(budget)) {
    settings.budgetMode = budget as BudgetMode;
  }
  if (time) {
    const n = Number.parseInt(time, 10);
    if (Number.isFinite(n) && n >= 5 && n <= 360) settings.maxMinutes = n;
  }
  if (anti) {
    const VALID = [
      'NO_OVEN',
      'ONE_PAN',
      'NOT_CHICKEN_AGAIN',
      'NO_LEFTOVERS',
      'NO_FRYING',
      'NO_CHOPPING',
      'SHORT_TIME',
      'NO_MULTISTEP',
    ];
    const filters = anti.split(',').filter((t) => VALID.includes(t)) as AntiFilter[];
    if (filters.length > 0) settings.antiFilters = filters;
  }
  return settings;
}

export function LoadingClient({ deps: depsOverride }: LoadingClientProps): React.ReactElement {
  const deps = useMemo<LoadingClientDeps>(
    () => ({ ...defaultDeps, ...depsOverride }),
    [depsOverride],
  );
  const router = useRouter();
  const searchParams = useSearchParams();
  const settings = useMemo(
    () =>
      parseSettings(
        searchParams.get('budget'),
        searchParams.get('time'),
        searchParams.get('anti'),
      ),
    [searchParams],
  );

  const [stage, setStage] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const startedRef = useRef(false);

  const run = useCallback(async (): Promise<void> => {
    setFailed(null);
    const result = await deps.fetchRecommendations(settings);
    if (result.error) {
      setFailed(result.error.error.message);
      return;
    }
    const ref = saveSessionResult({
      result: result.data,
      settings,
      createdAt: Date.now(),
    });
    router.push(`/today/result?ref=${ref}`);
  }, [deps, settings, router]);

  useEffect(() => {
    // Red flag #3: navigating back to /loading after a successful POST
    // must not re-POST — jump straight to the stored result instead.
    const params = new URLSearchParams(window.location.search);
    void params;
    if (startedRef.current) return;
    startedRef.current = true;
    void run();
  }, [run]);

  useEffect(() => {
    const timers = STAGES.map((s, i) =>
      s.untilMs === Number.POSITIVE_INFINITY
        ? undefined
        : setTimeout(() => setStage(i + 1), s.untilMs),
    );
    return () => {
      timers.forEach((t) => {
        if (t !== undefined) clearTimeout(t);
      });
    };
  }, []);

  const currentStage = STAGES[Math.min(stage, STAGES.length - 1)];
  const stageLabel = failed
    ? 'Не удалось получить рекомендации'
    : (currentStage?.label ?? 'Считаем рекомендации…');

  return (
    <>
      <TabTitle sublabel="Подбираем рецепты">Загрузка</TabTitle>
      <Card className="flex flex-col items-center gap-4 py-10" data-testid="loading-screen">
        {failed ? (
          <>
            <AlertTriangle size={40} className="text-[var(--color-warning)]" aria-hidden />
            <p className="text-sm text-[var(--color-text-muted)]" data-testid="loading-error">
              {failed}
            </p>
            <Button variant="primary" onClick={() => void run()} data-testid="loading-retry">
              Повторить
            </Button>
          </>
        ) : (
          <>
            <div
              className="h-1.5 w-48 overflow-hidden rounded-full bg-[var(--color-surface-2)]"
              role="progressbar"
              data-testid="loading-progress"
            >
              <div
                className="h-full w-1/3 rounded-full bg-[var(--color-primary)] animate-pulse"
                style={{ animation: 'mc-loading-slide 1.2s ease-in-out infinite' }}
              />
            </div>
            <p className="text-sm text-[var(--color-text-muted)]" data-testid="loading-stage">
              {stageLabel}
            </p>
          </>
        )}
      </Card>
    </>
  );
}
