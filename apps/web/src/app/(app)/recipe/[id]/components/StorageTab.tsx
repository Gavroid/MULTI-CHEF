'use client';

// StorageTab — the «Хранение» tab (MC-035): storage rules grouped as
// human-readable rows (freezing, fridge, partial prep, add-before-
// serving). Empty rules array renders a calm empty state.

import React from 'react';
import { Snowflake, ThumbsUp } from 'lucide-react';
import type { RecipeDetail, StorageMethod } from '@/lib/recipe-client';

const STORAGE_LABELS: Record<StorageMethod, string> = {
  FREEZE_OK: 'Можно заморозить',
  FRIDGE_ONLY: 'Только холодильник',
  PARTIAL_PREP: 'Можно подготовить заранее',
  NO_PREP: 'Хранению не подлежит',
  ADD_BEFORE_SERVING: 'Добавить перед подачей',
};

export interface StorageTabProps {
  recipe: RecipeDetail;
}

export function StorageTab({ recipe }: StorageTabProps): React.ReactElement {
  if (recipe.storageRules.length === 0) {
    return (
      <p
        className="py-6 text-center text-sm text-[var(--color-text-muted)]"
        data-testid="storage-empty"
      >
        Правила хранения для этого рецепта не заданы.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2" data-testid="storage-list">
      {recipe.storageRules.map((rule, index) => (
        <li
          key={`${rule.storageMethod}-${index}`}
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
            {rule.storageMethod === 'FREEZE_OK' ? (
              <Snowflake size={16} className="text-[var(--color-info)]" aria-hidden />
            ) : (
              <ThumbsUp size={16} className="text-[var(--color-fresh)]" aria-hidden />
            )}
            {STORAGE_LABELS[rule.storageMethod]}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {rule.maxHoursFridge !== null ? `Холодильник: до ${rule.maxHoursFridge} ч. ` : ''}
            {rule.maxDaysFreezer !== null ? `Морозилка: до ${rule.maxDaysFreezer} дн. ` : ''}
            {rule.addBeforeServing.length > 0
              ? `Перед подачей: ${rule.addBeforeServing.join(', ')}.`
              : ''}
          </p>
        </li>
      ))}
    </ul>
  );
}
