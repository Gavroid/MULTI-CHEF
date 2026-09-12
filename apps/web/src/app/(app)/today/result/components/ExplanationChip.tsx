'use client';

// ExplanationChip — the «почему это блюдо» plate on a result card
// (MC-034, PRD §2.3.4). bg-info-soft per the PRD explanation style.

import React from 'react';
import { Info } from 'lucide-react';

export interface ExplanationChipProps {
  text: string;
}

export function ExplanationChip({ text }: ExplanationChipProps): React.ReactElement {
  return (
    <p
      className="flex items-start gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-info-soft)] px-2.5 py-1.5 text-[11px] leading-4 text-[var(--color-info)]"
      data-testid="explanation-chip"
    >
      <Info size={12} className="mt-0.5 shrink-0" aria-hidden />
      {text}
    </p>
  );
}
