'use client';

// QuickScenarios — 4 shortcut chips on /today (MC-034, PRD §2.3.2).
// Each is a Link to /today/generate with a ?prefill= payload that
// WizardClient parses (NOTHING / .30. / ..NO_OVEN / URGENT).
//
// URGENT per manager decision #3: MINIMAL / 20 min / [SHORT_TIME,
// NO_MULTISTEP] — encoded as a compound prefill token.

import React from 'react';
import Link from 'next/link';
import { Clock, Ban, Zap, ShoppingBag } from 'lucide-react';
import { Card } from '@multichef/ui';

export interface QuickScenario {
  id: string;
  label: string;
  prefill: string;
  Icon: typeof Zap;
}

export const QUICK_SCENARIOS: QuickScenario[] = [
  { id: 'NOTHING', label: 'Ничего не покупать', prefill: 'NOTHING', Icon: ShoppingBag },
  { id: 'MAX_30', label: 'До 30 минут', prefill: '.30.', Icon: Clock },
  { id: 'NO_OVEN', label: 'Без духовки', prefill: '..NO_OVEN', Icon: Ban },
  // URGENT = MINIMAL budget + 20 min + [SHORT_TIME, NO_MULTISTEP] —
  // the wizard expands this token (manager decision #3).
  { id: 'URGENT', label: 'Срочно', prefill: 'URGENT', Icon: Zap },
];

export function QuickScenarios(): React.ReactElement {
  return (
    <Card className="mb-4" data-testid="quick-scenarios">
      <p className="mb-2 text-sm font-medium text-[var(--color-text)]">Быстрые сценарии</p>
      <div className="grid grid-cols-2 gap-2">
        {QUICK_SCENARIOS.map(({ id, label, prefill, Icon }) => (
          <Link
            key={id}
            href={`/today/generate?prefill=${prefill}`}
            data-testid={`scenario-${id}`}
            className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text)] active:bg-[var(--color-surface-2)]"
          >
            <Icon size={16} className="shrink-0 text-[var(--color-primary)]" aria-hidden />
            <span className="truncate">{label}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}
