'use client';

// AntiRecipesStep — wizard step 3: anti-filters (MC-034, PRD §2.3.3).
// 8 checkboxes (empty selection is valid — default). Submit pushes
// /today/loading with the settings in the query string.

import React from 'react';
import {
  ArrowLeft,
  Carrot,
  ChefHat,
  Clock,
  CookingPot,
  Flame,
  Repeat,
  Timer,
} from 'lucide-react';
import { Button, Card } from '@multichef/ui';
import type { AntiFilter } from '@multichef/contracts';

export interface AntiRecipesStepProps {
  selected: AntiFilter[];
  onChange: (value: AntiFilter[]) => void;
  onBack: () => void;
  onSubmit: () => void;
}

export const ANTI_OPTIONS: Array<{
  value: AntiFilter;
  label: string;
  Icon: typeof Flame;
}> = [
  { value: 'NO_OVEN', label: 'Без духовки', Icon: Flame },
  { value: 'ONE_PAN', label: 'Одна посуда', Icon: CookingPot },
  { value: 'NOT_CHICKEN_AGAIN', label: 'Не курицу снова', Icon: Repeat },
  { value: 'NO_LEFTOVERS', label: 'Без остатков', Icon: Carrot },
  { value: 'NO_FRYING', label: 'Без жарки', Icon: Flame },
  { value: 'NO_CHOPPING', label: 'Без нарезки', Icon: Carrot },
  { value: 'SHORT_TIME', label: 'Недолго (≤20 мин)', Icon: Timer },
  { value: 'NO_MULTISTEP', label: 'Без сложных шагов', Icon: ChefHat },
];

export function AntiRecipesStep({
  selected,
  onChange,
  onBack,
  onSubmit,
}: AntiRecipesStepProps): React.ReactElement {
  const toggle = (value: AntiFilter): void => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };
  return (
    <Card className="mb-4" data-testid="wizard-step-anti">
      <p className="mb-1 text-base font-semibold text-[var(--color-text)]">Что исключить?</p>
      <p className="mb-3 text-xs text-[var(--color-text-muted)]">
        Можно пропустить — просто нажмите «Получить рекомендацию».
      </p>
      <div className="flex flex-col gap-2" data-testid="anti-options">
        {ANTI_OPTIONS.map(({ value, label, Icon }) => {
          const checked = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              role="checkbox"
              aria-checked={checked}
              data-testid={`anti-${value}`}
              onClick={() => toggle(value)}
              className={
                checked
                  ? 'flex items-center gap-3 rounded-[var(--radius-md)] border-2 border-[var(--color-primary)] bg-[var(--color-surface)] px-3 py-2.5 text-left'
                  : 'flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2.5 text-left active:bg-[var(--color-surface-2)]'
              }
            >
              <Icon
                size={18}
                className={checked ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'}
                aria-hidden
              />
              <span className="text-sm text-[var(--color-text)]">{label}</span>
              {checked ? (
                <span className="ml-auto text-xs font-medium text-[var(--color-primary)]">✓</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onBack} data-testid="wizard-step-back">
          <ArrowLeft size={18} aria-hidden /> Назад
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          onClick={onSubmit}
          data-testid="wizard-submit"
        >
          <Clock size={18} aria-hidden /> Получить рекомендацию
        </Button>
      </div>
    </Card>
  );
}

export default AntiRecipesStep;
