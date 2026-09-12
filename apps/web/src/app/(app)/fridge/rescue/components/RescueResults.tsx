'use client';

// RescueResults — /fridge/rescue?step=result (MC-040).
//
// Pure render component: the ranked options + the «Использует X г из
// Y г» usage bar + accept («Готовлю это», mock until MC-051) and
// «Другой ингредиент» (back to the picker). All handlers come from
// RescueClient so tests can drive it without a router.

import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { Badge, Button, Card } from '@multichef/ui';
import type { RescueResponseDto } from '@multichef/contracts';
import { TabTitle } from '@/components/TabTitle';

export function formatGrams(grams: number): string {
  const rounded = Math.round(grams * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} г`;
}

export interface RescueResultsProps {
  result: RescueResponseDto;
  acceptBusy: boolean;
  onAccept: (recipeId: string) => void;
  onAnother: () => void;
}

export function RescueResults({
  result,
  acceptBusy,
  onAccept,
  onAnother,
}: RescueResultsProps): React.ReactElement {
  const { pantryUsage, ingredient } = result;
  const usesEverything =
    Math.abs(pantryUsage.usedGrams - pantryUsage.totalGrams) < 1e-9 && pantryUsage.totalGrams > 0;
  const percent =
    pantryUsage.totalGrams > 0
      ? Math.min(100, Math.round((pantryUsage.usedGrams / pantryUsage.totalGrams) * 100))
      : 0;

  return (
    <>
      <TabTitle sublabel={`Спасаем: ${ingredient.canonicalName}`}>Что приготовить</TabTitle>

      <Card className="mb-4" data-testid="rescue-usage">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-body">
            Использует {formatGrams(pantryUsage.usedGrams)} из {formatGrams(pantryUsage.totalGrams)}
          </span>
          {usesEverything ? (
            <Badge tone="fresh" data-testid="rescue-usage-badge">
              Весь запас
            </Badge>
          ) : null}
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          data-testid="rescue-usage-bar"
        >
          <div
            className="h-full rounded-full bg-[var(--color-primary)]"
            style={{ width: `${percent}%` }}
          />
        </div>
        {pantryUsage.usedGrams > pantryUsage.totalGrams ? (
          <p className="text-caption mt-1 text-[var(--color-text-muted)]">
            Рецептам нужно больше, чем есть дома — часть придётся докупить.
          </p>
        ) : null}
      </Card>

      {result.options.map((option, index) => (
        <Card key={`${option.recipe.id}-${index}`} className="mb-3" data-testid="rescue-card">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-title">{option.recipe.title}</h3>
            <Badge tone="info">{Math.round(option.score * 100)}%</Badge>
          </div>
          <p className="text-caption text-[var(--color-text-muted)]">
            {option.recipe.prepMinutes + option.recipe.cookMinutes} мин ·{' '}
            {option.type === 'FROM_PANTRY'
              ? option.toBuyCount === 0
                ? 'всё есть дома'
                : `докупить ${option.toBuyCount} продукт(а)`
              : 'всё есть дома'}
          </p>
          <p className="text-body mt-1 mb-3">{option.explanation}</p>
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={acceptBusy}
              onClick={() => onAccept(option.recipe.id)}
              data-testid={`rescue-accept-${option.recipe.id}`}
            >
              Готовлю это
            </Button>
            <a
              className="inline-flex h-10 items-center rounded-[var(--radius-sm)] px-4 text-sm text-[var(--color-primary)] underline"
              href={`/recipe/${option.recipe.id}?servings=${option.recipe.servings}`}
              data-testid={`rescue-details-${option.recipe.id}`}
            >
              Подробнее
            </a>
          </div>
        </Card>
      ))}

      <Card className="mb-6" data-testid="rescue-another">
        <Button variant="secondary" className="w-full" onClick={onAnother}>
          <ArrowLeft size={18} aria-hidden /> Другой ингредиент
        </Button>
      </Card>
    </>
  );
}
