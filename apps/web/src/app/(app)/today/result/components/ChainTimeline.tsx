'use client';

// ChainTimeline — mini timeline for CHAIN options (MC-034): the main
// recipe plus 2–3 follow-up recipes sharing an ingredient. Horizontal
// scroll on narrow screens (red flag #13).

import React from 'react';
import { ArrowRight } from 'lucide-react';

export interface ChainRecipe {
  id: string;
  title: string;
}

export interface ChainTimelineProps {
  main: ChainRecipe;
  followUps: ChainRecipe[];
  chainTag: string | null;
}

export function ChainTimeline({
  main,
  followUps,
  chainTag,
}: ChainTimelineProps): React.ReactElement | null {
  if (followUps.length === 0) {
    // Red flag #14: CHAIN fallback with chainTag=null and empty chain.
    return (
      <p className="mt-1 text-[11px] text-[var(--color-text-muted)]" data-testid="chain-empty">
        Нет подходящих цепочек
      </p>
    );
  }
  return (
    <div className="mt-2 overflow-x-auto" data-testid="chain-timeline">
      <div className="flex items-center gap-1.5 pb-1">
        <span className="shrink-0 rounded-full bg-[var(--color-primary-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-primary)]">
          {main.title}
        </span>
        {followUps.map((recipe) => (
          <React.Fragment key={recipe.id}>
            <ArrowRight size={12} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden />
            <span className="shrink-0 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">
              {recipe.title}
            </span>
          </React.Fragment>
        ))}
      </div>
      {chainTag ? (
        <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Цепочка: {chainTag}</p>
      ) : null}
    </div>
  );
}
