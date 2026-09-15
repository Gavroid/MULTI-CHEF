'use client';

// FridgeClient — orchestrator for the «Холодильник» page (PRD §2.3.3).
//
// MC-023 реализует полный CRUD: список с группировкой по сроку
// годности, FAB для добавления, фильтр Активные/Архив, диалоги
// редактирования и подтверждения удаления.
//
// Lives in its own file so the Next.js page module (page.tsx)
// remains a thin wrapper that just renders <FridgeClient /> — Next
// forbids named exports from page modules.

import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Plus, Refrigerator, AlertTriangle } from 'lucide-react';
import { Button, Card, Chip, Skeleton, toast } from '@multichef/ui';
import { TabTitle } from '@/components/TabTitle';
import { PantryItemCard } from '@/components/PantryItemCard';
import {
  AddPantryItemDialog,
  type AddPantryItemDialogDeps,
} from '@/components/AddPantryItemDialog';
import {
  EditPantryItemDialog,
  type EditPantryItemDialogDeps,
} from '@/components/EditPantryItemDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { ApiResponse } from '@/lib/auth-client';
import {
  listItems as listPantryItems,
  createItem as createPantryItem,
  updateItem as updatePantryItem,
  deleteItem as deletePantryItem,
  restoreItem as restorePantryItem,
  type ListPantryItemsOptions,
  type PantryItem,
} from '@/lib/pantry-client';
import { searchIngredients } from '@/lib/ingredient-client';
import { partitionByExpiry } from '@/lib/expiry';
import { readLocalUser } from '@/lib/auth-storage';

export interface FridgePageDeps {
  listItems: (
    options?: ListPantryItemsOptions,
    fetchOptions?: { signal?: AbortSignal },
  ) => Promise<ApiResponse<PantryItem[]>>;
  createItem: AddPantryItemDialogDeps['submit'];
  updateItem: EditPantryItemDialogDeps['submit'];
  deleteItem: (id: string) => Promise<ApiResponse<void>>;
  restoreItem: (id: string) => Promise<ApiResponse<PantryItem>>;
  searchIngredients: AddPantryItemDialogDeps['searchIngredients'];
}

const defaultDeps: FridgePageDeps = {
  listItems: listPantryItems,
  createItem: createPantryItem,
  updateItem: updatePantryItem,
  deleteItem: deletePantryItem,
  restoreItem: restorePantryItem,
  searchIngredients,
};

export interface FridgeClientProps {
  deps?: Partial<FridgePageDeps>;
  /** Date injected for deterministic tests. */
  now?: Date;
}

export function FridgeClient({ deps: depsOverride, now }: FridgeClientProps): ReactElement {
  // Spread once and memoize — without this every render produces a
  // fresh `deps` object, which invalidates the refetch useCallback
  // and triggers a runaway refetch loop (the page keeps GETting the
  // pantry list until the global rate limiter kicks in).
  const deps: FridgePageDeps = React.useMemo(
    () => ({ ...defaultDeps, ...depsOverride }),
    [depsOverride],
  );

  const [items, setItems] = useState<PantryItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<PantryItem | null>(null);
  const [deleting, setDeleting] = useState<PantryItem | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const refetch = useCallback(
    async (opts?: { includeArchived?: boolean }): Promise<void> => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setError(null);
      try {
        const effectiveInclude = opts?.includeArchived ?? includeArchived;
        const res = await deps.listItems(
          { includeArchived: effectiveInclude, sort: 'createdAt', order: 'desc', limit: 100 },
          { signal: ctrl.signal },
        );
        if (ctrl.signal.aborted) return;
        if (res.error) {
          setError(humaniseListError(res.error.error.code));
          setItems([]);
        } else if (res.data) {
          setItems(res.data);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Не удалось загрузить продукты');
        setItems([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    },
    [deps, includeArchived],
  );

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const onChipToggle = (next: 'active' | 'archive'): void => {
    const nextInclude = next === 'archive';
    if (nextInclude === includeArchived) return;
    setIncludeArchived(nextInclude);
    void refetch({ includeArchived: nextInclude });
  };

  const onCreated = (item: PantryItem): void => {
    setItems((prev) => (prev ? [item, ...prev] : [item]));
    toast.success('Продукт добавлен');
  };

  const onUpdated = (item: PantryItem): void => {
    setItems((prev) => (prev ? prev.map((it) => (it.id === item.id ? item : it)) : [item]));
    toast.success('Изменения сохранены');
  };

  const onDeleteConfirm = async (): Promise<void> => {
    if (!deleting) return;
    const res = await deps.deleteItem(deleting.id);
    if (res.error) {
      toast.danger('Не удалось удалить продукт');
      return;
    }
    setItems((prev) => (prev ? prev.filter((it) => it.id !== deleting.id) : prev));
    toast.success('Перенесено в архив');
    setDeleting(null);
    if (includeArchived) void refetch();
  };

  const onRestore = async (item: PantryItem): Promise<void> => {
    const res = await deps.restoreItem(item.id);
    if (res.error) {
      const code = res.error.error.code;
      toast.danger(
        code === 'ITEM_NOT_ARCHIVED' ? 'Продукт уже активен' : 'Не удалось восстановить',
      );
      return;
    }
    if (res.data) {
      setItems((prev) => (prev ? prev.filter((it) => it.id !== item.id) : prev));
      toast.success('Восстановлено');
      void refetch();
    }
  };

  const { expiring, fresh } = useMemo(
    () => (items ? partitionByExpiry(items, now ?? new Date()) : { expiring: [], fresh: [] }),
    [items, now],
  );

  const cardProps = {
    onEdit: setEditing,
    onDelete: setDeleting,
    onRestore,
  };

  // T46-D (E23): expiry labels roll over at the user's local midnight.
  const tz = readLocalUser()?.tz;

  return (
    <>
      <TabTitle sublabel="Ваши продукты">Холодильник</TabTitle>

      <div data-testid="fridge-filter-chips" className="flex gap-2 mb-3">
        <Chip
          selected={!includeArchived}
          onClick={(): void => onChipToggle('active')}
          data-testid="fridge-chip-active"
        >
          Активные
        </Chip>
        <Chip
          selected={includeArchived}
          onClick={(): void => onChipToggle('archive')}
          data-testid="fridge-chip-archive"
        >
          Архив
        </Chip>
      </div>

      {loading ? (
        <div data-testid="fridge-loading" className="flex flex-col gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : error ? (
        <Card data-testid="fridge-error">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-[var(--color-danger)] shrink-0" aria-hidden="true" />
            <div className="flex-1">
              <p className="text-body text-[var(--color-danger)]">{error}</p>
              <Button
                variant="secondary"
                onClick={(): void => {
                  void refetch();
                }}
                className="mt-2"
              >
                Повторить
              </Button>
            </div>
          </div>
        </Card>
      ) : items && items.length === 0 ? (
        <Card data-testid="fridge-empty">
          <div className="flex flex-col items-center gap-3 py-6">
            <Refrigerator size={36} aria-hidden="true" className="text-text-muted" />
            <h2 className="text-heading text-center">
              {includeArchived ? 'Архив пуст' : 'В холодильнике пока пусто'}
            </h2>
            <p className="text-body text-text-muted text-center max-w-xs">
              {includeArchived
                ? 'Удалённые продукты появятся здесь.'
                : 'Добавьте продукты — мы подскажем, что из них приготовить, и предупредим за 2 дня до истечения срока.'}
            </p>
            {!includeArchived ? (
              <Button onClick={(): void => setAddOpen(true)} data-testid="fridge-empty-add">
                <Plus size={16} aria-hidden="true" /> Добавить продукт
              </Button>
            ) : null}
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {expiring.length > 0 ? (
            <section data-testid="fridge-section-expiring">
              <h2 className="text-caption font-semibold text-text-muted mb-2 uppercase tracking-wide">
                Скоро истекает
              </h2>
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                {expiring.map((item) => (
                  <li key={item.id}>
                    <PantryItemCard
                      item={item}
                      {...(now ? { now } : {})}
                      {...(tz ? { tz } : {})}
                      {...cardProps}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {fresh.length > 0 ? (
            <section data-testid="fridge-section-fresh">
              <h2 className="text-caption font-semibold text-text-muted mb-2 uppercase tracking-wide">
                Свежие
              </h2>
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                {fresh.map((item) => (
                  <li key={item.id}>
                    <PantryItemCard
                      item={item}
                      {...(now ? { now } : {})}
                      {...(tz ? { tz } : {})}
                      {...cardProps}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}

      <button
        type="button"
        aria-label="Добавить продукт"
        data-testid="fridge-fab"
        onClick={(): void => setAddOpen(true)}
        className="fixed right-5 bottom-20 z-40 w-14 h-14 rounded-full bg-[var(--color-primary)] text-[var(--color-primary-fg)] shadow-lg flex items-center justify-center hover:opacity-90 active:scale-95 transition"
      >
        <Plus size={24} aria-hidden="true" />
      </button>

      <AddPantryItemDialog
        open={addOpen}
        deps={{ submit: deps.createItem, searchIngredients: deps.searchIngredients, onCreated }}
        onClose={(): void => setAddOpen(false)}
      />
      <EditPantryItemDialog
        open={editing !== null}
        item={editing}
        deps={{ submit: deps.updateItem, onUpdated }}
        onClose={(): void => setEditing(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Удалить продукт?"
        message={'Продукт будет перенесён в архив. Можно восстановить позже.'}
        confirmLabel="Удалить"
        confirmTone="danger"
        onConfirm={(): void => {
          void onDeleteConfirm();
        }}
        onClose={(): void => setDeleting(null)}
      />
    </>
  );
}

function humaniseListError(code: string): string {
  switch (code) {
    case 'UNAUTHORIZED':
      return 'Войдите, чтобы увидеть холодильник.';
    case 'NETWORK_ERROR':
      return 'Нет связи с сервером. Проверьте подключение.';
    default:
      return 'Не удалось загрузить продукты.';
  }
}
