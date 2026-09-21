'use client';

// PreferencesClient — /profile/preferences (PRD §2.3.16, R17-WP3).
//
// List of user's preferences (LOVE/DISLIKE/ALLERGY/EXCLUDE) plus a
// form to add a new one (ingredient search + chip for kind).
// Backend stores ingredientId for ingredient-bound preferences;
// ALLERGY/EXCLUDE are hard filters in the recommendation scoring.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, Card, Chip, Skeleton, toast } from '@multichef/ui';
import {
  PREFERENCE_KIND_VALUES,
  type PreferenceDto,
  type PreferenceKind,
} from '@multichef/contracts';
import {
  createPreference,
  deletePreference,
  listPreferences,
  type ProfileClientDeps,
} from '@/lib/profile-client';
import { searchIngredients } from '@/lib/ingredient-client';

const KIND_LABEL: Record<PreferenceKind, string> = {
  LOVE: 'Нравится',
  DISLIKE: 'Не нравится',
  ALLERGY: 'Аллергия',
  EXCLUDE: 'Исключить',
};

const KIND_TONE: Record<PreferenceKind, string> = {
  LOVE: 'bg-[var(--color-fresh-soft)] text-[var(--color-fresh)]',
  DISLIKE: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
  ALLERGY: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  EXCLUDE: 'bg-[var(--color-info-soft)] text-[var(--color-info)]',
};

interface IngredientPick {
  id: string;
  canonicalName: string;
}

export interface PreferencesClientProps {
  deps?: Partial<ProfileClientDeps>;
}

export function PreferencesClient({ deps }: PreferencesClientProps): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ReadonlyArray<PreferenceDto>>([]);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<ReadonlyArray<IngredientPick>>([]);
  const [picked, setPicked] = useState<IngredientPick | null>(null);
  const [kind, setKind] = useState<PreferenceKind>('LOVE');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback((): void => {
    setLoading(true);
    void listPreferences(deps ?? {}).then((res) => {
      if (res.error) {
        setError(res.error.error.message);
        setLoading(false);
        return;
      }
      setItems(res.data);
      setLoading(false);
    });
  }, [deps]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Debounced ingredient search — 300ms per PRD §2.3.7.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 1) {
      setMatches([]);
      return;
    }
    const handle = setTimeout(() => {
      setSearching(true);
      void searchIngredients({ q: term, limit: 8 })
        .then((res) => {
          setSearching(false);
          if (res.error || !res.data) {
            setMatches([]);
            return;
          }
          setMatches(res.data.map((i) => ({ id: i.id, canonicalName: i.canonicalName })));
        })
        .catch(() => {
          setSearching(false);
          setMatches([]);
        });
    }, 300);
    return (): void => {
      clearTimeout(handle);
    };
  }, [q]);

  const onAdd = useCallback(async (): Promise<void> => {
    if (!picked) {
      toast.warning('Выберите ингредиент из списка');
      return;
    }
    setBusy(true);
    const res = await createPreference({ ingredientId: picked.id, kind }, deps ?? {});
    setBusy(false);
    if (res.error) {
      toast.danger('Не удалось добавить: ' + res.error.error.message);
      return;
    }
    setItems((prev) => [...prev, res.data]);
    setPicked(null);
    setQ('');
    setMatches([]);
    toast.success('Добавлено');
  }, [deps, kind, picked]);

  const onDelete = useCallback(
    async (id: string): Promise<void> => {
      const res = await deletePreference(id, deps ?? {});
      if (res.error) {
        toast.danger('Не удалось удалить');
        return;
      }
      setItems((prev) => prev.filter((p) => p.id !== id));
      toast.success('Удалено');
    },
    [deps],
  );

  const kinds = useMemo(() => [...PREFERENCE_KIND_VALUES], []);

  // Group by kind for the listing.
  const grouped = useMemo(() => {
    const map: Record<PreferenceKind, PreferenceDto[]> = {
      LOVE: [],
      DISLIKE: [],
      ALLERGY: [],
      EXCLUDE: [],
    };
    for (const p of items) map[p.kind].push(p);
    return map;
  }, [items]);

  return (
    <div className="flex flex-col gap-4" data-testid="profile-preferences-page">
      <Link
        href="/profile"
        className="text-body text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        ← Профиль
      </Link>

      <Card>
        <h2 className="text-heading mb-1">Добавить предпочтение</h2>
        <p className="text-body text-[var(--color-text-muted)] mb-3">
          Аллергии и исключения — это жёсткие фильтры: такие ингредиенты не попадут в рекомендации
          «на сегодня» и в недельный план.
        </p>

        <label htmlFor="pref-search" className="text-body-strong block mb-1">
          Ингредиент
        </label>
        <div className="relative">
          <input
            id="pref-search"
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPicked(null);
            }}
            placeholder="напр. помидор"
            className="w-full h-12 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
            data-testid="preferences-search"
          />
          {matches.length > 0 && !picked ? (
            <ul
              className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]"
              data-testid="preferences-matches"
            >
              {matches.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(m);
                      setQ(m.canonicalName);
                      setMatches([]);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-[var(--color-surface-2)]"
                  >
                    {m.canonicalName}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {searching ? (
          <p className="text-caption text-[var(--color-text-muted)] mt-1">Поиск…</p>
        ) : null}

        <label className="text-body-strong block mb-1 mt-3">Тип предпочтения</label>
        <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Тип">
          {kinds.map((k) => (
            <Chip
              key={k}
              selected={kind === k}
              onClick={() => setKind(k)}
              data-testid={`preferences-kind-${k}`}
              aria-pressed={kind === k}
            >
              {KIND_LABEL[k]}
            </Chip>
          ))}
        </div>

        <Button
          variant="primary"
          disabled={busy || !picked}
          onClick={() => void onAdd()}
          data-testid="preferences-add"
        >
          {busy ? 'Добавляю…' : 'Добавить'}
        </Button>
      </Card>

      <Card>
        <h3 className="text-heading mb-2">Текущие предпочтения</h3>
        {loading ? (
          <Skeleton className="h-4 w-1/2" />
        ) : items.length === 0 ? (
          <p className="text-body text-[var(--color-text-muted)]">Пока ничего не добавлено.</p>
        ) : (
          <div className="flex flex-col gap-3" data-testid="preferences-list">
            {kinds.map((k) =>
              grouped[k].length === 0 ? null : (
                <div key={k}>
                  <p className="text-body-strong mb-1">{KIND_LABEL[k]}</p>
                  <ul className="flex flex-wrap gap-2">
                    {grouped[k].map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => void onDelete(p.id)}
                          className={`inline-flex items-center gap-1 px-3 h-10 rounded-[var(--radius-sm)] ${KIND_TONE[k]}`}
                          data-testid={`preferences-item-${p.id}`}
                          aria-label={`Удалить ${p.note ?? p.id}`}
                        >
                          <span className="text-body">
                            {p.note ??
                              (p.ingredientId ? `ингредиент ${p.ingredientId.slice(-4)}` : '—')}
                          </span>
                          <span aria-hidden="true">×</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}
          </div>
        )}
        {error ? (
          <p className="text-body text-[var(--color-danger)] mt-2" role="alert">
            {error}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
