'use client';

// TimeStep — wizard step 2: max cooking time (MC-034, PRD §2.3.3).
// Slider 15..120 + quick chips (15/30/60/120); Zod-validated.

import React from 'react';
import { ArrowLeft, ArrowRight, Clock } from 'lucide-react';
import { Button, Card } from '@multichef/ui';

export interface TimeStepProps {
  value: number;
  onChange: (value: number) => void;
  onBack: () => void;
  onNext: () => void;
}

const CHIPS = [15, 30, 60, 120];

export function TimeStep({ value, onChange, onBack, onNext }: TimeStepProps): React.ReactElement {
  const valid = Number.isFinite(value) && value >= 15 && value <= 120;
  return (
    <Card className="mb-4" data-testid="wizard-step-time">
      <p className="mb-3 text-base font-semibold text-[var(--color-text)]">
        Сколько времени готовите?
      </p>
      <p className="mb-2 text-2xl font-bold text-[var(--color-primary)]" data-testid="time-value">
        до {value} мин
      </p>
      <input
        type="range"
        min={15}
        max={120}
        step={5}
        value={value}
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10))}
        aria-label="Максимальное время приготовления"
        data-testid="time-slider"
        className="w-full accent-[var(--color-primary)]"
      />
      <div className="mt-3 flex gap-2" data-testid="time-chips">
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => onChange(chip)}
            aria-pressed={value === chip}
            data-testid={`time-chip-${chip}`}
            className={
              value === chip
                ? 'flex items-center gap-1 rounded-full bg-[var(--color-primary-soft)] px-3 py-1.5 text-xs font-medium text-[var(--color-primary)]'
                : 'flex items-center gap-1 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-muted)]'
            }
          >
            <Clock size={12} aria-hidden />
            {chip === 120 ? 'до 2 ч' : `${chip} мин`}
          </button>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <Button
          variant="secondary"
          className="flex-1"
          onClick={onBack}
          data-testid="wizard-step-back"
        >
          <ArrowLeft size={18} aria-hidden /> Назад
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          onClick={onNext}
          disabled={!valid}
          data-testid="wizard-step-next"
        >
          Далее <ArrowRight size={18} aria-hidden />
        </Button>
      </div>
    </Card>
  );
}

export default TimeStep;
