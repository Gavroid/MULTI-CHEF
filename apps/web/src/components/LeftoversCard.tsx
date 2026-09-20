'use client';

// R21 — «Превращение остатков»: выбираешь блюдо из активного плана,
// приложение показывает рецепты-преобразования (leftoverSourceOf).

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, Chip } from '@multichef/ui';
import { getActivePlan } from '@/lib/plan-client';
import { request } from '@/lib/auth-client';
import { getApiBaseUrl } from '@/lib/env';

interface LeftoversCardProps {
  deps?: {
    getActivePlan?: typeof getActivePlan;
  };
}

export function LeftoversCard({ deps }: LeftoversCardProps): React.ReactElement {
  const d = deps ?? { getActivePlan };
  const [dishes, setDishes] = useState<Array<{ id: string; title: string }>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [results, setResults] = useState<Array<{ recipe: { id: string; title: string } }>>([]);

  useEffect(() => {
    let cancelled = false;
    void d.getActivePlan!()
      .then((res) => {
        if (cancelled || !res.data) return;
        const titles = new Map<string, string>();
        for (const day of res.data.days) {
          for (const entry of day.entries) {
            if (!titles.has(entry.recipe.id)) {
              titles.set(entry.recipe.id, entry.recipe.title);
            }
          }
        }
        setDishes([...titles.entries()].map(([id, title]) => ({ id, title })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [d]);

  const show = useCallback(async (baseRecipeId: string): Promise<void> => {
    setSelected(baseRecipeId);
    try {
      const csrf = document.cookie
        .split('; ')
        .find((c) => c.startsWith('mc_csrf='))
        ?.split('=')[1];
      const res = await request<Array<{ recipe: { id: string; title: string } }>>(
        `${getApiBaseUrl()}/api/v1/recommendations/leftovers`,
        'POST',
        { baseRecipeIds: [baseRecipeId] },
        {
          idempotencyKey: crypto.randomUUID ? crypto.randomUUID() : `lo-${Date.now()}`,
          headers: csrf ? { 'X-CSRF-Token': csrf } : {},
        },
      );
      if (!res.error) setResults(res.data ?? []);
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  }, []);

  if (dishes.length === 0) return <Card className="mb-3" data-testid="leftovers-empty" />;

  return (
    <Card className="mb-3" data-testid="leftovers-card">
      <p className="text-body mb-2">Превратить остатки</p>
      <div className="flex flex-wrap gap-2 mb-2">
        {dishes.map((dish) => (
          <Chip
            key={dish.id}
            selected={selected === dish.id}
            onClick={() => void show(dish.id)}
            data-testid={`leftovers-dish-${dish.id}`}
          >
            {dish.title}
          </Chip>
        ))}
      </div>
      {results.length > 0 ? (
        <ul className="text-body flex flex-col gap-1">
          {results.map((r) => (
            <li key={r.recipe.id}>
              <Link
                href={`/recipe/${r.recipe.id}`}
                className="text-[var(--color-text)] underline-offset-2 hover:underline"
              >
                {r.recipe.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
