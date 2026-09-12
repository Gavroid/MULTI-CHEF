'use client';

// BudgetStep — wizard step 1: budget mode (MC-034, PRD §2.3.3).
// 3 radio cards; Zod-validated before «Далее» (always valid when one
// is selected, which the state guarantees — the button mirrors it).

import React from 'react';
import { ArrowRight, ShoppingBag, Wallet, Ban } from 'lucide-react';
import { Button, Card } from '@multichef/ui';
import type { BudgetMode } from '@multichef/contracts';

export interface BudgetStepProps {
  value: BudgetMode;
  onChange: (value: BudgetMode) => void;
  onNext: () => void;
}

const OPTIONS: Array<{
  value: BudgetMode;
  label: string;
  description: string;
  Icon: typeof Wallet;
}> = [
  {
    value: 'NOTHING',
    label: 'Ничего не покупать',
    description: 'Только то, что уже дома',
    Icon: Ban,
  },
  {
    value: 'MINIMAL',
    label: 'Минимальные покупки',
    description: 'Докупить пару позиций',
    Icon: ShoppingBag,
  },
  {
    value: 'NORMAL',
    label: 'Обычный режим',
    description: 'Могу зайти в магазин',
    Icon: Wallet,
  },
];

export function BudgetStep({ value, onChange, onNext }: BudgetStepProps): React.ReactElement {
  return (
    <Card className="mb-4" data-testid="wizard-step-budget">
      <p className="mb-3 text-base font-semibold text-[var(--color-text)]">Какой у вас бюджет?</p>
      <div
        className="flex flex-col gap-2"
        role="radiogroup"
        aria-label="Режим бюджета"
        data-testid="budget-options"
      >
        {OPTIONS.map(({ value: optionValue, label, description, Icon }) => {
          const selected = value === optionValue;
          return (
            <button
              key={optionValue}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid={`budget-${optionValue}`}
              onClick={() => onChange(optionValue)}
              className={
                selected
                  ? 'flex items-center gap-3 rounded-[var(--radius-md)] border-2 border-[var(--color-primary)] bg-[var(--color-surface)] px-3 py-3 text-left'
                  : 'flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-3 text-left active:bg-[var(--color-surface-2)]'
              }
            >
              <Icon
                size={20}
                className={
                  selected ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'
                }
                aria-hidden
              />
              <span>
                <span className="block text-sm font-medium text-[var(--color-text)]">{label}</span>
                <span className="block text-xs text-[var(--color-text-muted)]">{description}</span>
              </span>
            </button>
          );
        })}
      </div>
      <Button
        variant="primary"
        className="mt-4 w-full"
        onClick={onNext}
        data-testid="wizard-step-next"
      >
        Далее <ArrowRight size={18} aria-hidden />
      </Button>
    </Card>
  );
}

export default BudgetStep;
