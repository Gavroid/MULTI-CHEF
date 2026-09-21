'use client';

// LeftoversClient — /fridge/leftovers orchestrator (R17-WP2, PRD §2.3.9).
//
// Pattern follows RescueClient (MC-040) but adapted for the leftovers
// flow: chips of typical leftover kinds + free-text input. The
// `/recommendations/leftovers` endpoint takes baseRecipeIds — a list of
// recipe ids OR dish titles that the user wants to transform. We
// translate the chip selection into representative dish titles
// (canonical strings from the seed data set) and call the endpoint.
//
// Per BACKEND REVIEW 2026-09-21: the schema accepts EITHER ids OR
// titles (commit 4b8be92 loosened it), so sending titles is safe.

import React, { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, Chip } from '@multichef/ui';
import { toast } from '@multichef/ui';
import {
  LeftoversRequestDtoSchema,
  LeftoversResponseDtoSchema,
  type LeftoversResponseDto,
} from '@multichef/contracts';
import { type ErrorEnvelope, request } from '@/lib/auth-client';
import { getApiBaseUrl } from '@/lib/env';

// Canonical leftover-kind chips (PRD §2.3.9). Each chip maps to a
// representative dish title that the backend's `leftoverSourceOf`
// index recognises — see prisma/seed/recipes.ts for the canonical
// leftovers list. If we miss the title, the endpoint falls through
// and returns an empty options[]; that's why we use very common
// generic titles.
const LEFTOVER_KINDS: ReadonlyArray<{ kind: string; label: string; title: string }> = [
  { kind: 'PUREE', label: 'Картофельное пюре', title: 'Картофельное пюре' },
  { kind: 'BOILED_RICE', label: 'Варёный рис', title: 'Варёный рис' },
  { kind: 'CUTLET', label: 'Котлеты', title: 'Котлеты' },
  { kind: 'CHICKEN', label: 'Курица', title: 'Курица гриль' },
  { kind: 'VEGETABLES', label: 'Овощи', title: 'Овощи тушёные' },
  { kind: 'PORRIDGE', label: 'Каша', title: 'Каша гречневая' },
];

export interface LeftoversClientDeps {
  /** Test seam: replace request() to inject fixtures. */
  requestFn?: typeof request;
}

const defaultDeps: LeftoversClientDeps = {
  requestFn: request,
};

export function LeftoversClient({
  deps: depsOverride,
}: {
  deps?: LeftoversClientDeps;
}): React.ReactElement {
  const deps = { ...defaultDeps, ...depsOverride };
  const router = useRouter();
  const navigate = useCallback((url: string) => void router.push(url), [router]);

  const [selected, setSelected] = useState<ReadonlyArray<string>>([]);
  const [freeText, setFreeText] = useState('');
  const [busy, setBusy] = useState(false);
  const [fetchError, setFetchError] = useState<ErrorEnvelope | null>(null);
  const [options, setOptions] = useState<LeftoversResponseDto['options'] | null>(null);

  const doRequest = useCallback(
    async (baseRecipeIds: ReadonlyArray<string>): Promise<void> => {
      const validated = LeftoversRequestDtoSchema.safeParse({
        baseRecipeIds: [...baseRecipeIds],
      });
      if (!validated.success) {
        setFetchError({
          status: 400,
          error: { code: 'VALIDATION_ERROR', message: 'Не выбрано ни одного остатка' },
        });
        return;
      }
      setBusy(true);
      setFetchError(null);
      try {
        const res = await deps.requestFn!(
          `${getApiBaseUrl()}/api/v1/recommendations/leftovers`,
          'POST',
          validated.data,
          {},
        );
        if (res.error) {
          setFetchError(res.error);
          return;
        }
        const parsed = LeftoversResponseDtoSchema.safeParse(res.data);
        if (!parsed.success) {
          setFetchError({
            status: 502,
            error: { code: 'CONTRACT_MISMATCH', message: 'Сервер обновился, обновите страницу' },
          });
          return;
        }
        setOptions(parsed.data.options);
        if (parsed.data.options.length === 0) {
          toast.info('Не нашли подходящих блюд — попробуйте другие остатки');
        }
      } catch {
        setFetchError({
          status: 0,
          error: { code: 'NETWORK', message: 'Не удалось связаться с сервером' },
        });
      } finally {
        setBusy(false);
      }
    },
    [deps],
  );

  // Toggle a chip selection.
  const toggle = useCallback((title: string): void => {
    setSelected((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title],
    );
    setOptions(null);
    setFetchError(null);
  }, []);

  // Submit: chip selection wins; if user typed free-text we append it as
  // an extra "dish title" the backend can match against (schema accepts
  // free strings up to 200 chars).
  const onSubmit = useCallback((): void => {
    const base: ReadonlyArray<string> = freeText.trim()
      ? Array.from(new Set([...selected, freeText.trim().slice(0, 200)]))
      : selected;
    if (base.length === 0) {
      setFetchError({
        status: 400,
        error: { code: 'NO_INPUT', message: 'Выберите чип или введите остаток' },
      });
      return;
    }
    void doRequest(base);
  }, [doRequest, freeText, selected]);

  const chips = useMemo(() => LEFTOVER_KINDS, []);

  return (
    <div className="flex flex-col gap-4" data-testid="leftovers-page">
      <Card>
        <h2 className="text-heading mb-2">Что у вас осталось?</h2>
        <p className="text-body text-[var(--color-text-muted)] mb-3">
          Выберите чип или введите свой вариант — приложение предложит блюда-трансформации.
        </p>
        <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Типовые остатки">
          {chips.map((c) => (
            <Chip
              key={c.kind}
              selected={selected.includes(c.title)}
              onClick={() => toggle(c.title)}
              data-testid={`leftover-chip-${c.kind}`}
              aria-pressed={selected.includes(c.title)}
            >
              {c.label}
            </Chip>
          ))}
        </div>
        <label htmlFor="leftover-text" className="text-body-strong block mb-1">
          Свой вариант
        </label>
        <input
          id="leftover-text"
          type="text"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          maxLength={200}
          placeholder="Например: половина кабачка"
          className="w-full h-12 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
          data-testid="leftover-input"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || (selected.length === 0 && freeText.trim() === '')}
          className="mt-3 h-12 px-4 rounded-md bg-[var(--color-primary)] text-white text-body-strong disabled:opacity-45"
          data-testid="leftover-submit"
        >
          {busy ? 'Подбираю…' : 'Подобрать'}
        </button>
      </Card>

      {fetchError ? (
        <Card>
          <p
            className="text-body text-[var(--color-danger)]"
            role="alert"
            data-testid="leftover-error"
          >
            {fetchError.error.message}
          </p>
          <button
            type="button"
            onClick={() => {
              setFetchError(null);
              setOptions(null);
            }}
            className="mt-2 h-10 px-3 rounded-md border border-[var(--color-border)]"
          >
            Попробовать снова
          </button>
        </Card>
      ) : null}

      {options && options.length > 0 ? (
        <Card>
          <h3 className="text-heading mb-2">Было → Станет</h3>
          <ul className="flex flex-col gap-2" data-testid="leftover-options">
            {options.map((o) => (
              <li
                key={`${o.recipe.id}-${o.baseRecipeId}`}
                className="flex items-center justify-between"
              >
                <Link
                  href={`/recipe/${o.recipe.id}`}
                  className="text-body-strong underline-offset-2 hover:underline"
                  data-testid={`leftover-option-${o.recipe.id}`}
                >
                  {o.recipe.title}
                </Link>
                <button
                  type="button"
                  onClick={() => navigate(`/recipe/${o.recipe.id}`)}
                  className="h-10 px-3 rounded-md border border-[var(--color-border)] text-body"
                >
                  Подробнее
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
