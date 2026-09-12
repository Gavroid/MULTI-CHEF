'use client';

// IngredientPicker — step 1 of /fridge/rescue (MC-040).
//
// Chips of the household's pantry items; items that expire within
// 3 days or are marked USE_FIRST go into the «Срочно» group first
// (PRD §2.3.7: rescue starts from what is about to spoil). Client-side
// search filters the pantry (rescue targets YOUR items — a catalog
// search would mostly 404 on the server).

import React, { useMemo, useState } from 'react';
import { ArrowLeft, TriangleAlert } from 'lucide-react';
import { Button, Card, Chip, Input, Skeleton } from '@multichef/ui';
import { usePantry } from '@/hooks/usePantry';
import type { PantryItem } from '@/lib/pantry-client';
import { TabTitle } from '@/components/TabTitle';

export const URGENT_WINDOW_DAYS = 3;

export interface PickerChips {
  urgent: PantryItem[];
  rest: PantryItem[];
}

/** Split pantry into urgent (≤ today+N days or USE_FIRST) and the rest. */
export function selectPickerChips(items: PantryItem[], now: Date): PickerChips {
  // End of the 3rd day from today — date-only comparison so the whole
  // last day counts as urgent regardless of the current time.
  const cutoff = new Date(now);
  cutoff.setHours(23, 59, 59, 999);
  cutoff.setDate(cutoff.getDate() + URGENT_WINDOW_DAYS);
  const cutoffMs = cutoff.getTime();
  const urgent: PantryItem[] = [];
  const rest: PantryItem[] = [];
  for (const item of items) {
    const isUrgent =
      item.priority === 'USE_FIRST' ||
      (item.expiresAt != null && new Date(`${item.expiresAt}T23:59:59`).getTime() <= cutoffMs);
    if (isUrgent) urgent.push(item);
    else rest.push(item);
  }
  const byExpiry = (a: PantryItem, b: PantryItem): number =>
    (a.expiresAt ?? '9999-12-31').localeCompare(b.expiresAt ?? '9999-12-31');
  // USE_FIRST markers outrank plain expiry order inside the urgent group.
  urgent.sort(
    (a, b) =>
      (b.priority === 'USE_FIRST' ? 1 : 0) - (a.priority === 'USE_FIRST' ? 1 : 0) || byExpiry(a, b),
  );
  rest.sort(byExpiry);
  return { urgent, rest };
}

export function chipLabel(item: PantryItem): string {
  return item.notes ?? item.ingredientId;
}

export interface IngredientPickerProps {
  onPick: (ingredientId: string) => void;
  onBack: () => void;
}

export function IngredientPicker({ onPick, onBack }: IngredientPickerProps): React.ReactElement {
  const { items, loading } = usePantry();
  const [query, setQuery] = useState('');

  const chips = useMemo(() => selectPickerChips(items, new Date()), [items]);
  const q = query.trim().toLowerCase();
  const match = (item: PantryItem): boolean =>
    q === '' || chipLabel(item).toLowerCase().includes(q);

  const urgent = chips.urgent.filter(match);
  const rest = chips.rest.filter(match);
  const nothing = !loading && items.length === 0;

  return (
    <>
      <TabTitle sublabel="Спаси продукт">Что спасаем?</TabTitle>

      <div className="mb-3 flex items-center gap-2">
        <Input
          placeholder="Поиск в холодильнике…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск продукта"
          data-testid="rescue-search"
        />
      </div>

      {loading ? (
        <div className="flex flex-wrap gap-2" data-testid="rescue-picker-loading">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-20" />
        </div>
      ) : nothing ? (
        <Card className="mb-4" data-testid="rescue-picker-empty">
          <p className="text-body mb-3">
            В холодильнике пока пусто — добавьте продукты, чтобы спасать их из порчи.
          </p>
          <Button variant="secondary" onClick={onBack} data-testid="rescue-to-fridge">
            Перейти в холодильник
          </Button>
        </Card>
      ) : (
        <>
          {urgent.length > 0 ? (
            <section className="mb-4" data-testid="rescue-urgent-group">
              <h3 className="text-caption mb-2 flex items-center gap-1 text-[var(--color-text-muted)]">
                <TriangleAlert size={14} aria-hidden /> Срочно использовать
              </h3>
              <div className="flex flex-wrap gap-2">
                {urgent.map((item) => (
                  <Chip
                    key={item.id}
                    onClick={() => onPick(item.ingredientId)}
                    data-testid={`rescue-chip-${item.ingredientId}`}
                  >
                    {chipLabel(item)}
                  </Chip>
                ))}
              </div>
            </section>
          ) : null}

          {rest.length > 0 ? (
            <section className="mb-4" data-testid="rescue-rest-group">
              <h3 className="text-caption mb-2 text-[var(--color-text-muted)]">Всё, что есть</h3>
              <div className="flex flex-wrap gap-2">
                {rest.map((item) => (
                  <Chip
                    key={item.id}
                    onClick={() => onPick(item.ingredientId)}
                    data-testid={`rescue-chip-${item.ingredientId}`}
                  >
                    {chipLabel(item)}
                  </Chip>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      <Button variant="secondary" onClick={onBack} data-testid="rescue-back">
        <ArrowLeft size={18} aria-hidden /> В холодильник
      </Button>
    </>
  );
}
