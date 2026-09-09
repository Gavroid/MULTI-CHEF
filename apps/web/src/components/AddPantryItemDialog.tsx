'use client';

// AddPantryItemDialog — modal form to create a new PantryItem.
//
// Two tabs of complexity here:
//   1) Ingredient autocomplete — calls /api/v1/ingredients?q=...
//      with 300ms debounce and minimum 2-char threshold.
//   2) Submit — POSTs via the deps-injected `submit` (pantry-client
//      createItem). On success the parent closes the dialog and
//      refetches the list. On failure we surface the server error
//      message inline.
//
// We expose the form via the deps pattern so unit tests can run the
// component without the Next runtime.

import React, { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Search, Plus } from 'lucide-react';
import { Button, Input } from '@multichef/ui';
import { PantryDialog } from './PantryDialog';
import { FormErrorBanner } from './FormErrorBanner';
import type { ApiResponse } from '@/lib/auth-client';
import type { CreatePantryItemInput, PantryItem, Unit } from '@/lib/pantry-client';
import type { Ingredient } from '@/lib/ingredient-client';

export interface AddPantryItemDialogDeps {
  submit: (
    body: CreatePantryItemInput,
    options?: { signal?: AbortSignal },
  ) => Promise<ApiResponse<PantryItem>>;
  searchIngredients: (
    query: { q: string },
    options?: { signal?: AbortSignal },
  ) => Promise<ApiResponse<Ingredient[]>>;
  onCreated: (item: PantryItem) => void;
}

export interface AddPantryItemDialogProps {
  open: boolean;
  deps: AddPantryItemDialogDeps;
  onClose: () => void;
}

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;

export function AddPantryItemDialog({
  open,
  deps,
  onClose,
}: AddPantryItemDialogProps): ReactElement {
  const [ingredientQuery, setIngredientQuery] = useState('');
  const [ingredientResults, setIngredientResults] = useState<Ingredient[]>([]);
  const [selectedIngredient, setSelectedIngredient] = useState<Ingredient | null>(null);
  const [quantity, setQuantity] = useState('100');
  const [unit, setUnit] = useState<Unit>('G');
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // ── Ingredient search (debounced) ──────────────────────────────
  useEffect(() => {
    if (!open) return;
    if (selectedIngredient) return; // user already picked one
    const trimmed = ingredientQuery.trim();
    if (trimmed.length < MIN_QUERY_LEN) {
      setIngredientResults([]);
      return;
    }
    const handle = setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      deps
        .searchIngredients({ q: trimmed }, { signal: ctrl.signal })
        .then((res) => {
          if (res.data) setIngredientResults(res.data.slice(0, 10));
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          // Silent — the input will just stay empty.
        });
    }, DEBOUNCE_MS);
    return (): void => clearTimeout(handle);
  }, [ingredientQuery, open, selectedIngredient, deps]);

  // ── Reset on close ──────────────────────────────────────────────
  useEffect(() => {
    if (open) return;
    setIngredientQuery('');
    setIngredientResults([]);
    setSelectedIngredient(null);
    setQuantity('100');
    setUnit('G');
    setExpiresAt('');
    setNotes('');
    setSubmitting(false);
    setError(null);
    abortRef.current?.abort();
  }, [open]);

  const submit = useCallback(
    async (e: React.FormEvent): Promise<void> => {
      e.preventDefault();
      setError(null);
      if (!selectedIngredient) {
        setError('Выберите ингредиент');
        return;
      }
      const qty = Number(quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        setError('Количество должно быть положительным числом');
        return;
      }
      setSubmitting(true);
      try {
        const body: CreatePantryItemInput = {
          ingredientId: selectedIngredient.id,
          quantityG: qty,
          unit,
          ...(expiresAt ? { expiresAt } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        };
        const res = await deps.submit(body);
        if (res.error) {
          setError(humaniseCreateError(res.error.error.code));
        } else if (res.data) {
          deps.onCreated(res.data);
          onClose();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось добавить продукт');
      } finally {
        setSubmitting(false);
      }
    },
    [selectedIngredient, quantity, unit, expiresAt, notes, deps, onClose],
  );

  return (
    <PantryDialog
      open={open}
      title="Добавить продукт"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button
            type="submit"
            form="add-pantry-form"
            loading={submitting}
            disabled={submitting || !selectedIngredient}
            data-testid="add-pantry-submit"
          >
            <Plus size={16} aria-hidden="true" /> Добавить
          </Button>
        </div>
      }
    >
      <form id="add-pantry-form" onSubmit={submit} className="flex flex-col gap-3">
        <FormErrorBanner message={error} />

        <div className="flex flex-col gap-1">
          <label htmlFor="ingredient" className="text-caption font-medium">
            Ингредиент
          </label>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted"
              aria-hidden="true"
            />
            <input
              id="ingredient"
              data-testid="add-pantry-ingredient-input"
              type="text"
              autoComplete="off"
              placeholder="Поиск (мин. 2 символа)…"
              value={selectedIngredient ? selectedIngredient.canonicalName : ingredientQuery}
              onChange={(e): void => {
                setSelectedIngredient(null);
                setIngredientQuery(e.target.value);
              }}
              className="w-full border border-border rounded-md py-2 pl-7 pr-3 bg-bg"
            />
          </div>
          {ingredientResults.length > 0 && !selectedIngredient ? (
            <ul
              data-testid="add-pantry-ingredient-list"
              className="border border-border rounded-md bg-card max-h-48 overflow-y-auto"
            >
              {ingredientResults.map((ing) => (
                <li key={ing.id}>
                  <button
                    type="button"
                    onClick={(): void => {
                      setSelectedIngredient(ing);
                      setIngredientQuery(ing.canonicalName);
                      setIngredientResults([]);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-[var(--color-bg-elevated)] flex justify-between gap-2"
                  >
                    <span className="truncate">{ing.canonicalName}</span>
                    <span className="text-caption text-text-muted">{ing.category.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Количество"
            type="number"
            inputMode="numeric"
            min={1}
            value={quantity}
            onChange={(e): void => setQuantity(e.target.value)}
            data-testid="add-pantry-quantity"
          />
          <div className="flex flex-col gap-1">
            <span className="text-caption font-medium">Единица</span>
            <div role="radiogroup" aria-label="Единица измерения" className="flex gap-2">
              {(['G', 'ML', 'PIECE'] as Unit[]).map((u) => (
                <label
                  key={u}
                  className={`flex-1 border rounded-md py-2 text-center cursor-pointer text-caption ${
                    unit === u
                      ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)] border-[var(--color-primary)]'
                      : 'border-border'
                  }`}
                >
                  <input
                    type="radio"
                    name="unit"
                    value={u}
                    checked={unit === u}
                    onChange={(): void => setUnit(u)}
                    className="sr-only"
                  />
                  {unitLabel(u)}
                </label>
              ))}
            </div>
          </div>
        </div>

        <Input
          label="Годен до (необязательно)"
          type="date"
          value={expiresAt}
          onChange={(e): void => setExpiresAt(e.target.value)}
          data-testid="add-pantry-expires"
        />

        <label className="flex flex-col gap-1">
          <span className="text-caption font-medium">Заметка (необязательно)</span>
          <textarea
            value={notes}
            onChange={(e): void => setNotes(e.target.value.slice(0, 500))}
            maxLength={500}
            rows={2}
            data-testid="add-pantry-notes"
            className="border border-border rounded-md p-2 bg-bg resize-none"
            placeholder="Например: открытая пачка"
          />
          <span className="text-caption text-text-muted text-right">{notes.length}/500</span>
        </label>
      </form>
    </PantryDialog>
  );
}

function unitLabel(u: Unit): string {
  switch (u) {
    case 'G':
      return 'г';
    case 'ML':
      return 'мл';
    case 'PIECE':
      return 'шт';
  }
}

function humaniseCreateError(code: string): string {
  switch (code) {
    case 'INGREDIENT_NOT_FOUND':
      return 'Ингредиент не найден. Выберите из списка.';
    case 'VALIDATION_ERROR':
      return 'Проверьте поля — что-то заполнено неверно.';
    case 'UNAUTHORIZED':
      return 'Войдите, чтобы добавлять продукты.';
    default:
      return 'Не удалось добавить продукт. Попробуйте ещё раз.';
  }
}
