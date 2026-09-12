'use client';

// BudgetProgress — weekly budget bar for /today (MC-034). Hidden when
// the household has no budget set. spentRatio comes from the caller
// (backend budget rollup lands with MC-051; until then 0 spent).

import React from 'react';
import { Wallet } from 'lucide-react';
import { Card } from '@multichef/ui';

export interface BudgetProgressProps {
  /** Weekly budget in kopecks (null = not set → block hidden). */
  budgetWeekKopecks: number | null;
  /** Spent this week in kopecks; defaults to 0 until MC-051. */
  spentKopecks?: number;
}

/** "₽240 из 2 000" — roubles with thin spaces for thousands. */
export function formatKopecks(kopecks: number): string {
  const rubles = Math.round(kopecks / 100);
  return `₽${rubles.toLocaleString('ru-RU')}`;
}

export function BudgetProgress({
  budgetWeekKopecks,
  spentKopecks = 0,
}: BudgetProgressProps): React.ReactElement | null {
  if (budgetWeekKopecks === null || budgetWeekKopecks <= 0) return null;
  const ratio = Math.min(1, spentKopecks / budgetWeekKopecks);
  const percent = Math.round(ratio * 100);
  return (
    <Card className="mb-4" data-testid="budget-progress">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
        <Wallet size={16} className="text-[var(--color-primary)]" aria-hidden />
        Бюджет на неделю
      </p>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        data-testid="budget-bar"
      >
        <div
          className="h-full rounded-full bg-[var(--color-primary)]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]" data-testid="budget-label">
        {formatKopecks(spentKopecks)} из {formatKopecks(budgetWeekKopecks)} ({percent}%)
      </p>
    </Card>
  );
}
