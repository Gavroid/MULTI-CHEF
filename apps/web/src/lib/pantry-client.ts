// pantry-client — typed fetch wrapper for /api/v1/pantry/items.
//
// Mirrors the auth-client envelope shape (`{ data, error }`) so the
// same `ApiResponse` type fits both modules. PantryItemView fields
// are taken verbatim from apps/api/src/pantry/pantry.service.ts —
// keep them in lock-step when the backend schema evolves.
//
// Soft-delete semantics (ADR-0021, MC-022):
//   - DELETE = sets archivedAt = now() (204 No Content)
//   - restore = clears archivedAt back to null; 400 ITEM_NOT_ARCHIVED
//     if the row is already active
//   - GET with ?includeArchived=false (default) hides archived rows
//
// The backend's pantry.controller.ts file header still says "hard
// delete" — that's stale commentary from MC-022 draft 1. The
// service has used soft delete since ADR-0021 was applied. Don't
// believe the comment, believe the service.

import {
  type ApiResponse,
  type FetchOptions,
  generateIdempotencyKey,
  request,
} from './auth-client';
import { getApiBaseUrl } from './env';

export type Unit = 'G' | 'ML' | 'PIECE';
export type AmountStatus = 'PLENTY' | 'SOME' | 'LOW';
export type Priority = 'NORMAL' | 'USE_FIRST' | 'STAPLE';
export type StorageLocation = 'PANTRY' | 'FRIDGE' | 'FREEZER';

export interface PantryItem {
  id: string;
  householdId: string;
  ingredientId: string;
  /** Catalogue name (audit fix — optional for older cached payloads). */
  name?: string | null;
  /** Decimal grams — the API coerces to a JS number. */
  quantity: number;
  unit: Unit;
  estimatedGrams: number;
  amountStatus: AmountStatus;
  priority: Priority;
  storageLocation: StorageLocation;
  opened: boolean;
  /** ISO date (YYYY-MM-DD), null if no expiry set. */
  expiresAt: string | null;
  /** ISO date (YYYY-MM-DD), null if not tracked. */
  purchaseDate: string | null;
  /** ISO timestamp if archived (soft-deleted), null when active. */
  archivedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePantryItemInput {
  ingredientId: string;
  quantityG: number;
  unit?: Unit;
  amountStatus?: AmountStatus;
  priority?: Priority;
  storageLocation?: StorageLocation;
  opened?: boolean;
  expiresAt?: string;
  purchaseDate?: string;
  notes?: string;
}

export type UpdatePantryItemInput = {
  quantityG?: number;
  unit?: Unit;
  amountStatus?: AmountStatus;
  priority?: Priority;
  storageLocation?: StorageLocation;
  opened?: boolean;
  /**
   * The Zod schema (apps/api/src/pantry/pantry.dto.ts) accepts `null`
   * here to clear an existing expiry date.
   */
  expiresAt?: string | null;
  purchaseDate?: string | null;
  /** `null` clears the existing note (Zod schema accepts `null`). */
  notes?: string | null;
};

export interface ListPantryItemsOptions {
  includeArchived?: boolean;
  ingredientId?: string;
  sort?: 'createdAt' | 'expiresAt' | 'quantityG';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

function buildQueryString(opts: ListPantryItemsOptions): string {
  const params = new URLSearchParams();
  if (opts.includeArchived) params.set('includeArchived', 'true');
  if (opts.ingredientId) params.set('ingredientId', opts.ingredientId);
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.order) params.set('order', opts.order);
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.offset !== undefined && opts.offset > 0) {
    params.set('offset', String(opts.offset));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

function pantryUrl(path: string): string {
  const trimmed = path.replace(/^\/+/, '');
  return `${getApiBaseUrl()}/api/v1/pantry/${trimmed}`;
}

export function listItems(
  options: ListPantryItemsOptions = {},
  fetchOptions: FetchOptions = {},
): Promise<ApiResponse<PantryItem[]>> {
  return request<PantryItem[]>(
    pantryUrl(`items${buildQueryString(options)}`),
    'GET',
    undefined,
    fetchOptions,
  );
}

export function getItem(
  id: string,
  fetchOptions: FetchOptions = {},
): Promise<ApiResponse<PantryItem>> {
  return request<PantryItem>(
    pantryUrl(`items/${encodeURIComponent(id)}`),
    'GET',
    undefined,
    fetchOptions,
  );
}

export function createItem(
  body: CreatePantryItemInput,
  fetchOptions: FetchOptions = {},
): Promise<ApiResponse<PantryItem>> {
  return request<PantryItem>(pantryUrl('items'), 'POST', body, {
    ...fetchOptions,
    idempotencyKey: fetchOptions.idempotencyKey ?? generateIdempotencyKey(),
  });
}

export function updateItem(
  id: string,
  body: UpdatePantryItemInput,
  fetchOptions: FetchOptions = {},
): Promise<ApiResponse<PantryItem>> {
  return request<PantryItem>(
    pantryUrl(`items/${encodeURIComponent(id)}`),
    'PATCH',
    body,
    fetchOptions,
  );
}

export function deleteItem(
  id: string,
  fetchOptions: FetchOptions = {},
): Promise<ApiResponse<void>> {
  return request<void>(
    pantryUrl(`items/${encodeURIComponent(id)}`),
    'DELETE',
    {},
    {
      ...fetchOptions,
      idempotencyKey: fetchOptions.idempotencyKey ?? generateIdempotencyKey(),
    },
  );
}

export function restoreItem(
  id: string,
  fetchOptions: FetchOptions = {},
): Promise<ApiResponse<PantryItem>> {
  return request<PantryItem>(
    pantryUrl(`items/${encodeURIComponent(id)}/restore`),
    'POST',
    {},
    {
      ...fetchOptions,
      idempotencyKey: fetchOptions.idempotencyKey ?? generateIdempotencyKey(),
    },
  );
}
