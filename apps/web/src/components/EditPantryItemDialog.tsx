'use client';

// EditPantryItemDialog — modal form to update an existing PantryItem.
//
// Pre-fills every editable field from the passed PantryItem. The
// ingredient itself is locked (changing which ingredient the entry
// refers to would be a different operation — delete + create). We
// allow editing quantity, unit, amountStatus, priority,
// storageLocation, opened, expiresAt, notes.

import React, { useEffect, useState, type ReactElement } from 'react';
import { Button, Input } from '@multichef/ui';
import { PantryDialog } from './PantryDialog';
import { FormErrorBanner } from './FormErrorBanner';
import type { ApiResponse } from '@/lib/auth-client';
import type {
  AmountStatus,
  PantryItem,
  Priority,
  StorageLocation,
  Unit,
  UpdatePantryItemInput,
} from '@/lib/pantry-client';

export interface EditPantryItemDialogDeps {
  submit: (
    id: string,
    body: UpdatePantryItemInput,
    options?: { signal?: AbortSignal },
  ) => Promise<ApiResponse<PantryItem>>;
  onUpdated: (item: PantryItem) => void;
}

export interface EditPantryItemDialogProps {
  open: boolean;
  item: PantryItem | null;
  deps: EditPantryItemDialogDeps;
  onClose: () => void;
}

export function EditPantryItemDialog({
  open,
  item,
  deps,
  onClose,
}: EditPantryItemDialogProps): ReactElement {
  const [quantity, setQuantity] = useState('100');
  const [unit, setUnit] = useState<Unit>('G');
  const [amountStatus, setAmountStatus] = useState<AmountStatus>('SOME');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [storageLocation, setStorageLocation] = useState<StorageLocation>('FRIDGE');
  const [opened, setOpened] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when a new item is loaded.
  useEffect(() => {
    if (!item) return;
    setQuantity(String(item.quantity));
    setUnit(item.unit);
    setAmountStatus(item.amountStatus);
    setPriority(item.priority);
    setStorageLocation(item.storageLocation);
    setOpened(item.opened);
    setExpiresAt(item.expiresAt ?? '');
    setNotes(item.notes ?? '');
    setError(null);
  }, [item]);

  useEffect(() => {
    if (open) return;
    setError(null);
  }, [open]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!item) return;
    setError(null);
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Количество должно быть положительным числом');
      return;
    }
    setSubmitting(true);
    try {
      const body: UpdatePantryItemInput = {
        quantityG: qty,
        unit,
        amountStatus,
        priority,
        storageLocation,
        opened,
        expiresAt: expiresAt ? expiresAt : null,
        notes: notes.trim() ? notes.trim() : null,
      };
      const res = await deps.submit(item.id, body);
      if (res.error) {
        setError(humaniseUpdateError(res.error.error.code));
      } else if (res.data) {
        deps.onUpdated(res.data);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PantryDialog
      open={open && item !== null}
      title="Редактировать продукт"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button
            type="submit"
            form="edit-pantry-form"
            loading={submitting}
            disabled={submitting || !item}
            data-testid="edit-pantry-submit"
          >
            Сохранить
          </Button>
        </div>
      }
    >
      {item ? (
        <form id="edit-pantry-form" onSubmit={submit} className="flex flex-col gap-3">
          <FormErrorBanner message={error} />
          {error ? (
            <span id="edit-pantry-error" className="sr-only">
              {error}
            </span>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Количество"
              type="number"
              inputMode="numeric"
              min={1}
              value={quantity}
              onChange={(e): void => setQuantity(e.target.value)}
              data-testid="edit-pantry-quantity"
            />
            <div className="flex flex-col gap-1">
              <span className="text-caption font-medium">Единица</span>
              <div role="radiogroup" className="flex gap-2">
                {(['G', 'ML', 'PIECE'] as Unit[]).map((u) => (
                  <label
                    key={u}
                    className={`flex-1 border rounded-md py-2 text-center cursor-pointer text-caption ${
                      unit === u
                        ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)] border-[var(--color-primary)]'
                        : 'border-border'
                    }`}
                  >
                    <input
                      type="radio"
                      name="unit-edit"
                      value={u}
                      checked={unit === u}
                      onChange={(): void => setUnit(u)}
                      className="sr-only"
                    />
                    {u === 'G' ? 'г' : u === 'ML' ? 'мл' : 'шт'}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <SegmentedField
            label="Количество остатка"
            value={amountStatus}
            options={[
              ['PLENTY', 'Много'],
              ['SOME', 'Немного'],
              ['LOW', 'Мало'],
            ]}
            onChange={(v): void => setAmountStatus(v as AmountStatus)}
            testId="edit-pantry-amount-status"
          />
          <SegmentedField
            label="Приоритет"
            value={priority}
            options={[
              ['NORMAL', 'Обычный'],
              ['USE_FIRST', 'Использовать первым'],
              ['STAPLE', 'Запас'],
            ]}
            onChange={(v): void => setPriority(v as Priority)}
            testId="edit-pantry-priority"
          />
          <SegmentedField
            label="Где хранится"
            value={storageLocation}
            options={[
              ['PANTRY', 'Кладовка'],
              ['FRIDGE', 'Холодильник'],
              ['FREEZER', 'Морозилка'],
            ]}
            onChange={(v): void => setStorageLocation(v as StorageLocation)}
            testId="edit-pantry-storage"
          />

          <label className="flex items-center gap-2 text-caption">
            <input
              type="checkbox"
              checked={opened}
              onChange={(e): void => setOpened(e.target.checked)}
              data-testid="edit-pantry-opened"
            />
            Упаковка вскрыта
          </label>

          <Input
            label="Годен до"
            type="date"
            value={expiresAt}
            onChange={(e): void => setExpiresAt(e.target.value)}
            data-testid="edit-pantry-expires"
          />

          <label className="flex flex-col gap-1">
            <span className="text-caption font-medium">Заметка</span>
            <textarea
              value={notes}
              onChange={(e): void => setNotes(e.target.value.slice(0, 500))}
              maxLength={500}
              rows={2}
              data-testid="edit-pantry-notes"
              className="border border-border rounded-md p-2 bg-bg resize-none"
              placeholder="Например: осталось половина пачки"
            />
            <span className="text-caption text-text-muted text-right">{notes.length}/500</span>
          </label>
        </form>
      ) : null}
    </PantryDialog>
  );
}

interface SegmentedFieldProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (v: T) => void;
  testId?: string;
}

function SegmentedField<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: SegmentedFieldProps<T>): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption font-medium">{label}</span>
      <div role="radiogroup" className="flex gap-2 flex-wrap" data-testid={testId}>
        {options.map(([v, labelText]) => (
          <label
            key={v}
            className={`border rounded-md py-1.5 px-3 cursor-pointer text-caption ${
              value === v
                ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)] border-[var(--color-primary)]'
                : 'border-border'
            }`}
          >
            <input
              type="radio"
              name={testId ?? label}
              value={v}
              checked={value === v}
              onChange={(): void => onChange(v)}
              className="sr-only"
            />
            {labelText}
          </label>
        ))}
      </div>
    </div>
  );
}

function humaniseUpdateError(code: string): string {
  switch (code) {
    case 'PANTRY_ITEM_NOT_FOUND':
      return 'Продукт не найден (возможно, уже удалён).';
    case 'VALIDATION_ERROR':
      return 'Проверьте поля — что-то заполнено неверно.';
    default:
      return 'Не удалось сохранить изменения.';
  }
}
