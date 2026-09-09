// ingredient-client — typed fetch wrapper for /api/v1/ingredients.
//
// The catalog is public (no auth required — see MC-021 controller
// header). The autocomplete UI in AddPantryItemDialog calls
// `searchIngredients({ q, limit })` on every keystroke, debounced
// upstream at 300ms (the dialog handles the debounce — this module
// just exposes a single call).

import { type ApiResponse, type FetchOptions, request } from './auth-client';
import { getApiBaseUrl } from './env';

export interface Ingredient {
  id: string;
  canonicalName: string;
  defaultUnit: string;
  packageSize: number | null;
  avgPriceKopecks: number | null;
  density: number | null;
  ediblePartRatio: number;
  status: string;
  category: { id: string; name: string; sortOrder: number };
  aliases: { alias: string; locale: string }[];
}

export interface IngredientCategory {
  id: string;
  name: string;
  sortOrder: number;
}

export interface SearchIngredientsOptions {
  q?: string;
  category?: string;
  limit?: number;
  offset?: number;
  sort?: 'canonicalName' | 'avgPriceKopecks';
  order?: 'asc' | 'desc';
}

function ingredientUrl(path: string): string {
  // `path` is either 'categories' or a query string like '?q=foo'.
  // We keep the trailing slash off the bare collection path (Fastify
  // otherwise rejects GET /ingredients/?q=… with 404 / route
  // mismatch) and we DON'T prepend `/` before `?` (that would yield
  // /ingredients/?q=…).
  const trimmed = path.replace(/^\/+/, '');
  if (trimmed.startsWith('?')) {
    return `${getApiBaseUrl()}/api/v1/ingredients${trimmed}`;
  }
  return `${getApiBaseUrl()}/api/v1/ingredients/${trimmed}`;
}

function buildQueryString(opts: SearchIngredientsOptions): string {
  const params = new URLSearchParams();
  if (opts.q && opts.q.length > 0) params.set('q', opts.q);
  if (opts.category) params.set('category', opts.category);
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.offset !== undefined && opts.offset > 0) params.set('offset', String(opts.offset));
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.order) params.set('order', opts.order);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function searchIngredients(
  options: SearchIngredientsOptions = {},
  fetchOptions: FetchOptions = {},
): Promise<ApiResponse<Ingredient[]>> {
  return request<Ingredient[]>(
    ingredientUrl(buildQueryString(options)),
    'GET',
    undefined,
    fetchOptions,
  );
}

export function listCategories(
  fetchOptions: FetchOptions = {},
): Promise<ApiResponse<IngredientCategory[]>> {
  return request<IngredientCategory[]>(ingredientUrl('categories'), 'GET', undefined, fetchOptions);
}
