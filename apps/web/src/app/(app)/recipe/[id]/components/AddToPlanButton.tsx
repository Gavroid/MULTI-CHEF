'use client';

// AddToPlanButton — the sticky bottom CTA (MC-035). Per the manager
// decision Q1 it is a deep-link <Link> to /plan/setup (no POST here);
// the sticky container pads for the iOS home indicator via
// env(safe-area-inset-bottom) and clears the fixed BottomTabBar.

import React from 'react';
import Link from 'next/link';
import { CalendarPlus } from 'lucide-react';

export interface AddToPlanButtonProps {
  recipeId: string;
  servings: number;
}

export function AddToPlanButton({ recipeId, servings }: AddToPlanButtonProps): React.ReactElement {
  const href = `/plan/setup?recipeId=${encodeURIComponent(recipeId)}&servings=${servings}`;
  return (
    <div
      className="sticky bottom-16 z-20 -mx-4 mt-6 border-t border-[var(--color-border)] bg-[var(--color-bg)] px-4 pt-3"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
      data-testid="add-to-plan-sticky"
    >
      <Link
        href={href}
        data-testid="add-to-plan-button"
        className="flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-base font-semibold text-white active:scale-[.99]"
      >
        <CalendarPlus size={20} aria-hidden />
        Добавить в план
      </Link>
    </div>
  );
}
