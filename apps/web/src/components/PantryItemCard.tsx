'use client';

// PantryItemCard — a single ingredient row in the fridge list.
//
// Pure presentational component. Visibility decisions (archived vs
// active, "В архиве" badge, Restore button) live here. Mutation
// callbacks (onEdit, onDelete, onRestore) are injected via props so
// the component is unit-testable without state machinery.

import React, { type ReactElement } from 'react';
import { Refrigerator, Pencil, Trash2, RotateCcw, Archive } from 'lucide-react';
import { Badge } from '@multichef/ui';
import { formatExpiry } from '@/lib/expiry';
import type { PantryItem } from '@/lib/pantry-client';

export interface PantryItemCardProps {
  item: PantryItem;
  /**
   * Optional override for the canonical name shown next to the
   * quantity. The fridge page fetches the matching Ingredient to
   * show a Russian label; when not provided we fall back to the
   * ULID so QA can see what they're looking at.
   */
  displayName?: string;
  now?: Date;
  onEdit?: (item: PantryItem) => void;
  onDelete?: (item: PantryItem) => void;
  onRestore?: (item: PantryItem) => void;
}

export function PantryItemCard({
  item,
  displayName,
  now,
  onEdit,
  onDelete,
  onRestore,
}: PantryItemCardProps): ReactElement {
  const expiry = formatExpiry(item.expiresAt, now);
  const isArchived = item.archivedAt !== null;
  const name = displayName ?? item.ingredientId;

  return (
    <article
      data-testid={`pantry-item-${item.id}`}
      data-archived={isArchived ? 'true' : 'false'}
      className="border border-border rounded-md p-3 bg-card flex gap-3 items-start"
    >
      <div className="shrink-0 mt-0.5 text-text-muted">
        <Refrigerator size={20} aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="text-body font-semibold truncate">{name}</h3>
          <span className="text-caption text-text-muted">{formatQuantity(item)}</span>
        </div>

        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <span
            data-testid={`pantry-item-${item.id}-expiry`}
            data-tone={expiry.tone}
            className={`text-caption font-medium ${toneClass(expiry.tone)}`}
          >
            {expiry.text}
          </span>
          {isArchived ? (
            <Badge tone="neutral" data-testid={`pantry-item-${item.id}-archived-badge`}>
              <Archive size={12} aria-hidden="true" /> В архиве
            </Badge>
          ) : null}
        </div>

        {item.notes ? (
          <p className="mt-1 text-caption text-text-muted line-clamp-1" title={item.notes}>
            {item.notes}
          </p>
        ) : null}
      </div>

      <div className="flex gap-1 shrink-0">
        {isArchived ? (
          <button
            type="button"
            aria-label="Восстановить"
            data-testid={`pantry-item-${item.id}-restore`}
            className="p-2 rounded hover:bg-[var(--color-bg-elevated)] text-text-muted"
            onClick={(): void => onRestore?.(item)}
          >
            <RotateCcw size={16} aria-hidden="true" />
          </button>
        ) : (
          <>
            <button
              type="button"
              aria-label="Редактировать"
              data-testid={`pantry-item-${item.id}-edit`}
              className="p-2 rounded hover:bg-[var(--color-bg-elevated)] text-text-muted"
              onClick={(): void => onEdit?.(item)}
            >
              <Pencil size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Удалить"
              data-testid={`pantry-item-${item.id}-delete`}
              className="p-2 rounded hover:bg-[var(--color-bg-elevated)] text-text-muted"
              onClick={(): void => onDelete?.(item)}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function formatQuantity(item: PantryItem): string {
  const q = Math.round(item.quantity);
  switch (item.unit) {
    case 'G':
      return `${q} г`;
    case 'ML':
      return `${q} мл`;
    case 'PIECE':
      return pluralPieces(q);
  }
}

function pluralPieces(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? 'штука'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)
        ? 'штуки'
        : 'штук';
  return `${n} ${word}`;
}

function toneClass(tone: 'neutral' | 'warning' | 'danger' | 'muted'): string {
  switch (tone) {
    case 'neutral':
      return 'text-text';
    case 'warning':
      return 'text-[var(--color-warning)]';
    case 'danger':
      return 'text-[var(--color-danger)]';
    case 'muted':
      return 'text-text-muted';
  }
}
