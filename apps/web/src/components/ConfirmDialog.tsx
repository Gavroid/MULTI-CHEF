'use client';

// ConfirmDialog — minimal confirm/cancel dialog built on the native
// <dialog> element. Used by PantryItemCard's delete action and
// elsewhere where we need a one-shot yes/no prompt without
// dragging in a portal library.

import React, { type ReactElement } from 'react';
import { Button } from '@multichef/ui';
import { PantryDialog } from './PantryDialog';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmTone?: 'primary' | 'danger';
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Отмена',
  confirmTone = 'primary',
  onConfirm,
  onClose,
}: ConfirmDialogProps): ReactElement {
  return (
    <PantryDialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            variant={confirmTone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            data-testid="confirm-dialog-confirm"
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-body">{message}</p>
    </PantryDialog>
  );
}
