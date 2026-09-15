'use client';

// OptionCard — one recommendation card on /today/result (MC-034,
// PRD §2.3.4): type badge, title, score, explanation plate, optional
// chain timeline, «Готовлю это» + «Подробнее о КБЖУ» (per manager
// decision #1 the §2.5.7 disclaimer itself lives on /recipe/[id]).

import React, { useState } from 'react';
import Link from 'next/link';
import { ChefHat, Link2, ShoppingCart } from 'lucide-react';
import { Badge, Button, Card } from '@multichef/ui';
import { recipeImageUrl } from '@/lib/recipe-image';
import type { TodayOptionDto } from '@multichef/contracts';
import { ExplanationChip } from './ExplanationChip';
import { ChainTimeline } from './ChainTimeline';

export const OPTION_BADGES: Record<
  TodayOptionDto['type'],
  { label: string; tone: 'fresh' | 'info' | 'warning' }
> = {
  FROM_PANTRY: { label: 'Из того, что есть', tone: 'fresh' },
  BEST_MATCH: { label: 'Лучший вариант', tone: 'info' },
  CHAIN: { label: 'Выгодная цепочка', tone: 'warning' },
};

export interface OptionCardProps {
  option: TodayOptionDto;
  /** Accept handler («Готовлю это»); busy state disables the button. */
  onAccept: (recipeId: string) => void;
  acceptBusy?: boolean;
  acceptError?: string | null;
}

export function OptionCard({
  option,
  onAccept,
  acceptBusy = false,
  acceptError = null,
}: OptionCardProps): React.ReactElement {
  const [imageFailed, setImageFailed] = useState(false);
  const { recipe, score, explanation } = option;
  const badge = OPTION_BADGES[option.type];
  const servings = recipe.servings > 0 ? recipe.servings : 2;

  return (
    <Card className="mb-4" data-testid={`option-${option.type}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <Badge tone={badge.tone} data-testid={`badge-${option.type}`}>
          {option.type === 'FROM_PANTRY' ? (
            <ShoppingCart size={12} aria-hidden />
          ) : option.type === 'CHAIN' ? (
            <Link2 size={12} aria-hidden />
          ) : (
            <ChefHat size={12} aria-hidden />
          )}
          {badge.label}
        </Badge>
        <span
          className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-semibold tabular-nums text-[var(--color-text-muted)]"
          data-testid={`score-${option.type}`}
        >
          {Math.round(score * 100)}%
        </span>
      </div>

      <div className="mb-3 flex gap-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-surface-2)]">
          {recipe.imageKey && !imageFailed ? (
            // T3: below-the-fold thumbnail is lazy and decoded off-thread;
            // explicit 64x64 (h-16 w-16) dimensions keep CLS at 0.
            <img
              src={recipeImageUrl(recipe.imageKey) ?? undefined}
              alt={recipe.title}
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
              width={64}
              height={64}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[var(--color-text-muted)]">
              <ChefHat size={22} aria-hidden />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <h3
            className="truncate text-base font-semibold text-[var(--color-text)]"
            data-testid={`title-${option.type}`}
          >
            {recipe.title}
          </h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            {recipe.prepMinutes + recipe.cookMinutes} мин · сложность {recipe.difficulty}/3
          </p>
          {option.type === 'FROM_PANTRY' ? (
            <p className="mt-0.5 text-[11px] text-[var(--color-fresh)]" data-testid="tobuy-count">
              Докупить: {option.toBuyCount}
            </p>
          ) : null}
        </div>
      </div>

      <ExplanationChip text={explanation} />

      {option.type === 'CHAIN' ? (
        <ChainTimeline
          main={{ id: recipe.id, title: recipe.title }}
          followUps={option.chain.map((r) => ({ id: r.id, title: r.title }))}
          chainTag={option.chainTag}
        />
      ) : null}

      {acceptError ? (
        <p
          className="mt-2 text-xs text-[var(--color-warning)]"
          data-testid={`accept-error-${option.type}`}
        >
          {acceptError}
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <Button
          variant="primary"
          className="flex-1"
          onClick={() => onAccept(recipe.id)}
          disabled={acceptBusy}
          data-testid={`accept-${option.type}`}
        >
          Готовлю это
        </Button>
        <Link
          href={`/recipe/${recipe.id}?servings=${servings}`}
          data-testid={`details-${option.type}`}
          className="flex h-14 items-center rounded-[var(--radius-md)] border-[1.5px] border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-text)]"
        >
          Подробнее о КБЖУ
        </Link>
      </div>
    </Card>
  );
}
