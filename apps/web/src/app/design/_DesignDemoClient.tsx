'use client';

// Client-side interactive demo for Toast + BottomSheet. Kept separate so
// the rest of /_design stays a server component (faster initial paint).

import { useState } from 'react';
import { BottomSheet, Button, toast } from '@multichef/ui';

export function DesignDemoClient(): React.ReactElement {
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            toast.success('Сохранено в план');
          }}
        >
          Toast: success
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            toast.warning('Срок годности истекает через 2 дня');
          }}
        >
          Toast: warning
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            toast.show({
              message: 'Рецепт удалён',
              tone: 'info',
              action: { label: 'Отменить', onClick: () => toast.info('Восстановлено') },
            });
          }}
        >
          Toast: с действием
        </Button>
      </div>
      <Button variant="primary" onClick={() => setSheetOpen(true)}>
        Открыть BottomSheet
      </Button>
      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Добавить в план"
        primaryAction={
          <Button
            variant="primary"
            onClick={() => {
              toast.success('Добавлено');
              setSheetOpen(false);
            }}
          >
            Готово
          </Button>
        }
      >
        <p className="text-body mb-3">
          Содержимое модалки. Здесь будут формы выбора дня недели и порции.
        </p>
      </BottomSheet>
    </div>
  );
}
