// MC-010 — envelope mapper from internal codes to HTTP responses.
//
// docs/api/conventions.md §2.1 specifies the closed error-code enum
// and the corresponding HTTP status codes. Keep this table in sync
// with that file (it is the source of truth).

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  // conventions.md §2.1: Idempotency-Key replayed with a different
  // body (T15-A/T20-B — the code was specified in the docs but never
  // emitted until the replay cache landed).
  | 'IDEMPOTENT_REPLAY'
  | 'RATE_LIMITED'
  | 'JOB_FAILED'
  | 'INTERNAL_ERROR'
  | 'BAD_REQUEST' // Domain-specific 400/404 — share HTTP status with the generic
  // code but let the client disambiguate which resource is missing
  // or which business invariant was violated.
  | 'INGREDIENT_NOT_FOUND'
  | 'RECIPE_NOT_FOUND'
  | 'MEAL_PLAN_NOT_FOUND'
  | 'HOUSEHOLD_NOT_FOUND'
  | 'USER_NOT_FOUND'
  | 'SESSION_NOT_FOUND'
  | 'PANTRY_ITEM_NOT_FOUND'
  | 'SHOPPING_LIST_NOT_FOUND'
  | 'SHOPPING_ITEM_NOT_FOUND'
  | 'JOB_NOT_FOUND'
  | 'PLAN_NOT_FOUND'
  | 'PREP_TASK_NOT_FOUND'
  // MC-040/042 domain codes
  | 'EMPTY_RESCUE'
  | 'ROULETTE_EMPTY'
  | 'REJECT_LIMIT_REACHED'
  // MC-033 CSRF double-submit
  | 'CSRF_MISMATCH'
  // MC-010 health/ready degraded dependencies
  | 'SERVICE_UNAVAILABLE'
  | 'PREFERENCE_NOT_FOUND'
  | 'NUTRITION_PROFILE_NOT_FOUND'
  | 'ITEM_NOT_ARCHIVED'
  // T15-B: PATCH on a soft-deleted (archived) pantry item — the row
  // exists but the caller must restore it before modifying.
  | 'PANTRY_ITEM_ARCHIVED';

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INGREDIENT_NOT_FOUND: 404,
  RECIPE_NOT_FOUND: 404,
  MEAL_PLAN_NOT_FOUND: 404,
  HOUSEHOLD_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  SESSION_NOT_FOUND: 404,
  PANTRY_ITEM_NOT_FOUND: 404,
  SHOPPING_LIST_NOT_FOUND: 404,
  SHOPPING_ITEM_NOT_FOUND: 404,
  JOB_NOT_FOUND: 404,
  PLAN_NOT_FOUND: 404,
  PREP_TASK_NOT_FOUND: 404,
  EMPTY_RESCUE: 422,
  ROULETTE_EMPTY: 422,
  REJECT_LIMIT_REACHED: 409,
  CSRF_MISMATCH: 403,
  SERVICE_UNAVAILABLE: 503,
  PREFERENCE_NOT_FOUND: 404,
  NUTRITION_PROFILE_NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENT_REPLAY: 409,
  RATE_LIMITED: 429,
  JOB_FAILED: 422,
  // ITEM_NOT_ARCHIVED is intentionally 400 (not 404) — the row
  // exists; the caller tried an operation that requires a state it
  // doesn't currently have. Future variants of this code (e.g.
  // ITEM_ALREADY_ARCHIVED) can share the 400 mapping.
  ITEM_NOT_ARCHIVED: 400,
  // T15-B: the archived row exists — 409 signals a state conflict
  // (restore first), not a missing resource.
  PANTRY_ITEM_ARCHIVED: 409,
  INTERNAL_ERROR: 500,
};

export interface ErrorInput {
  code: ErrorCode | string;
  message?: string | undefined;
  details?: Record<string, unknown> | null | undefined;
  requestId?: string | undefined;
}

export interface ErrorBody {
  status: number;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
}

const REDACTED = '[REDACTED]';
const SECRET_KEYS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'token',
  'sessionToken',
  'cookieSecret',
  'secret',
]);

// Exported for the exception filter, which redacts the same key set
// from its server-side log records (T18-D) — the outgoing response
// and the journal must agree on what counts as a secret.
export function redactSecrets(input: unknown): unknown {
  if (input === null || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map(redactSecrets);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SECRET_KEYS.has(key)) {
      out[key] = REDACTED;
    } else {
      out[key] = redactSecrets(value);
    }
  }
  return out;
}

/**
 * Translate an internal error spec into the canonical HTTP envelope.
 * Unknown codes fall back to 500 INTERNAL_ERROR. Password-shaped
 * keys in `details` are redacted before serialisation.
 */
export function toErrorBody(input: ErrorInput): ErrorBody {
  const code = (STATUS_BY_CODE[input.code as ErrorCode] ? input.code : 'INTERNAL_ERROR') as
    ErrorCode | 'INTERNAL_ERROR';
  const status = STATUS_BY_CODE[code];
  const details = input.details
    ? (redactSecrets(input.details) as Record<string, unknown>)
    : undefined;
  return {
    status,
    error: {
      code,
      message: input.message ?? defaultMessageFor(code),
      ...(details ? { details } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    },
  };
}

function defaultMessageFor(code: ErrorCode): string {
  switch (code) {
    case 'VALIDATION_ERROR':
    case 'BAD_REQUEST':
      return 'Request validation failed';
    case 'UNAUTHORIZED':
      return 'Authentication required';
    case 'FORBIDDEN':
    case 'CSRF_MISMATCH':
      return 'Access denied';
    case 'SERVICE_UNAVAILABLE':
      return 'Service unavailable';
    case 'NOT_FOUND':
    case 'INGREDIENT_NOT_FOUND':
    case 'RECIPE_NOT_FOUND':
    case 'MEAL_PLAN_NOT_FOUND':
    case 'HOUSEHOLD_NOT_FOUND':
    case 'USER_NOT_FOUND':
    case 'SESSION_NOT_FOUND':
    case 'PANTRY_ITEM_NOT_FOUND':
    case 'SHOPPING_LIST_NOT_FOUND':
    case 'SHOPPING_ITEM_NOT_FOUND':
    case 'JOB_NOT_FOUND':
    case 'PLAN_NOT_FOUND':
    case 'PREP_TASK_NOT_FOUND':
    case 'PREFERENCE_NOT_FOUND':
    case 'NUTRITION_PROFILE_NOT_FOUND':
      return 'Resource not found';
    case 'CONFLICT':
    case 'REJECT_LIMIT_REACHED':
      return 'Resource conflict';
    case 'IDEMPOTENT_REPLAY':
      return 'Idempotency-Key was already used with a different request';
    case 'RATE_LIMITED':
      return 'Too many requests';
    case 'EMPTY_RESCUE':
    case 'ROULETTE_EMPTY':
      return 'Подходящих рецептов не нашлось';
    case 'JOB_FAILED':
      return 'Job failed';
    case 'ITEM_NOT_ARCHIVED':
      return 'Item is not archived';
    case 'PANTRY_ITEM_ARCHIVED':
      return 'Item is archived';
    case 'INTERNAL_ERROR':
      return 'Internal server error';
  }
}

/**
 * Convenience for NestJS exception filters: pull the request id off the
 * Express request and call `toErrorBody`. The request id is set by the
 * upstream middleware (see main.ts).
 */
export function envelopeFromRequest(req: unknown, input: ErrorInput): ErrorBody {
  const requestId = (req as { requestId?: string }).requestId;
  return toErrorBody({ ...input, ...(requestId ? { requestId } : {}) });
}
