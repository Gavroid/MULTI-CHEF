// auth-client — typed fetch wrapper for the MULTI-CHEF auth API.
//
// Auth endpoints live under `${baseUrl}/api/v1/auth/*`. mc_session is an
// HttpOnly cookie set by the server — the browser sends it automatically
// with `credentials: 'include'`. We do NOT read or write the cookie from
// the client; that is purely server-side state.
//
// The wire envelope is `{ data, error }` per docs/api/conventions.md §2.
// `error` is `{ code, message, details?, requestId? }`. `details` for
// VALIDATION_ERROR carries `{ fields: { [fieldName]: string[] } }`.

import { getApiBaseUrl } from './env';

const SESSION_COOKIE = 'mc_session';

export interface ErrorEnvelope {
  status: number;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
}

export interface AuthUser {
  id: string;
  email: string;
  status: 'ACTIVE' | 'BLOCKED' | 'DELETED';
  tz: string;
  locale: string;
  isGuestConverted: boolean;
}

export interface AuthHousehold {
  id: string;
}

export interface AuthSuccess {
  user: AuthUser;
  household: AuthHousehold;
  sessionToken: string;
}

export interface ApiSuccess<T> {
  data: T;
  error?: undefined;
}
export interface ApiFailure {
  data?: undefined;
  error: ErrorEnvelope;
}
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface FetchOptions {
  /** AbortController.signal to cancel in-flight requests on unmount. */
  signal?: AbortSignal;
  /** Idempotency-Key header value. Required for POST/PUT/PATCH/DELETE. */
  idempotencyKey?: string;
  /** Additional headers merged after defaults. */
  headers?: Record<string, string>;
}

function authUrl(path: string): string {
  // path is e.g. '/auth/login'; strip a leading slash to avoid '//'.
  const trimmed = path.replace(/^\/+/, '');
  return `${getApiBaseUrl()}/api/v1/${trimmed}`;
}

/**
 * Generate a UUID v4 Idempotency-Key. Uses crypto.randomUUID() when
 * available (Node 19+, all modern browsers), falls back to a manual
 * v4-shaped string from crypto.getRandomValues for older runtimes.
 */
export function generateIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function request<T>(
  path: string,
  method: 'POST' | 'GET',
  body: unknown,
  options: FetchOptions,
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers ?? {}),
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // Every POST/PUT/PATCH/DELETE must carry an Idempotency-Key (server's
  // global guard — apps/api/src/common/idempotency.ts). GET endpoints
  // may omit it.
  if (method !== 'GET') {
    headers['Idempotency-Key'] = options.idempotencyKey ?? generateIdempotencyKey();
  }

  const init: RequestInit = {
    method,
    credentials: 'include',
    headers,
    ...(options.signal ? { signal: options.signal } : {}),
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  let response: Response;
  try {
    response = await fetch(authUrl(path), init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    // Network / CORS / DNS failure. Surface as a synthetic 0-status error.
    return {
      error: {
        status: 0,
        error: {
          code: 'NETWORK_ERROR',
          message: err instanceof Error ? err.message : 'Network error',
        },
      },
    };
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      // Malformed JSON — treat as opaque error.
    }
  }

  if (response.ok) {
    const envelope = payload as { data?: T; error?: ErrorEnvelope } | null;
    if (envelope && typeof envelope === 'object' && 'data' in envelope) {
      return { data: envelope.data as T };
    }
    // Some endpoints (e.g. logout) return 204 with no body.
    return { data: undefined as unknown as T };
  }

  // Error path: server returns { status, error: { code, message, ... } }.
  // We return the WHOLE envelope (including top-level `status`) so the
  // caller can branch on HTTP status without having to map code→status
  // themselves.
  const envelope = payload as { status?: number; error?: ErrorEnvelope['error'] } | null;
  if (envelope && envelope.error) {
    return {
      error: {
        status: typeof envelope.status === 'number' ? envelope.status : response.status,
        error: envelope.error,
      },
    };
  }
  return {
    error: {
      status: response.status,
      error: {
        code: 'INTERNAL_ERROR',
        message: `HTTP ${response.status}`,
      },
    },
  };
}

export function login(
  body: { email: string; password: string },
  options: FetchOptions = {},
): Promise<ApiResponse<AuthSuccess>> {
  return request<AuthSuccess>('/auth/login', 'POST', body, options);
}

export function register(
  body: { email: string; password: string; householdName?: string },
  options: FetchOptions = {},
): Promise<ApiResponse<AuthSuccess>> {
  return request<AuthSuccess>('/auth/register', 'POST', body, options);
}

export function logout(options: FetchOptions = {}): Promise<ApiResponse<void>> {
  return request<void>('/auth/logout', 'POST', {}, options);
}

export function getSession(
  options: FetchOptions = {},
): Promise<ApiResponse<{ user: AuthUser; household: AuthHousehold }>> {
  return request<{ user: AuthUser; household: AuthHousehold }>(
    '/auth/session',
    'GET',
    undefined,
    options,
  );
}

export { SESSION_COOKIE };
