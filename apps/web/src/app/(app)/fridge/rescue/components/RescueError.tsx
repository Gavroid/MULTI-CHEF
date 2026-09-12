'use client';

// RescueError — failure / empty states of /fridge/rescue (MC-040).
//
// - not-found (404 INGREDIENT_NOT_FOUND): the ingredient is not in the
//   pantry → link to /fridge/add.
// - empty (422 EMPTY_RESCUE): honest «нет рецептов» + escape hatch.
// - network: toast-equivalent inline message + retry.

import React from 'react';
import { Button, Card } from '@multichef/ui';

export type RescueErrorKind = 'not-found' | 'empty' | 'network';

const HEADINGS: Record<RescueErrorKind, string> = {
  'not-found': 'Продукт не найден в холодильнике',
  empty: 'Нет рецептов с этим продуктом',
  network: 'Не удалось получить рекомендации',
};

export interface RescueErrorProps {
  kind: RescueErrorKind;
  message?: string;
  onRetry: () => void;
  onAnother: () => void;
}

export function RescueError({
  kind,
  message,
  onRetry,
  onAnother,
}: RescueErrorProps): React.ReactElement {
  return (
    <Card className="mt-6" data-testid={`rescue-error-${kind}`}>
      <h3 className="text-title mb-2">{HEADINGS[kind]}</h3>
      {message ? (
        <p className="text-body mb-3">{message}</p>
      ) : (
        <p className="text-body mb-3">Попробуйте ещё раз или выберите другой продукт.</p>
      )}
      {kind === 'not-found' ? (
        <a
          className="inline-flex h-10 items-center rounded-[var(--radius-sm)] px-4 text-sm text-[var(--color-primary)] underline"
          href="/fridge/add"
          data-testid="rescue-error-add"
        >
          Добавить продукт
        </a>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button variant="primary" onClick={onRetry} data-testid="rescue-error-retry">
          Повторить
        </Button>
        <Button variant="secondary" onClick={onAnother} data-testid="rescue-error-another">
          Другой ингредиент
        </Button>
      </div>
    </Card>
  );
}
