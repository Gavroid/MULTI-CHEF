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
  | 'RATE_LIMITED'
  | 'JOB_FAILED'
  | 'INTERNAL_ERROR' // Domain-specific 404s — share HTTP 404 with NOT_FOUND but let
  // the client disambiguate which resource is missing.
  | 'INGREDIENT_NOT_FOUND'
  | 'RECIPE_NOT_FOUND'
  | 'MEAL_PLAN_NOT_FOUND'
  | 'HOUSEHOLD_NOT_FOUND'
  | 'USER_NOT_FOUND'
  | 'SESSION_NOT_FOUND'
  | 'PANTRY_ITEM_NOT_FOUND'
  | 'SHOPPING_LIST_NOT_FOUND'
  | 'PREFERENCE_NOT_FOUND'
  | 'NUTRITION_PROFILE_NOT_FOUND';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
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
  PREFERENCE_NOT_FOUND: 404,
  NUTRITION_PROFILE_NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  JOB_FAILED: 422,
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

function redactSecrets(input: unknown): unknown {
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
      return 'Request validation failed';
    case 'UNAUTHORIZED':
      return 'Authentication required';
    case 'FORBIDDEN':
      return 'Access denied';
    case 'NOT_FOUND':
    case 'INGREDIENT_NOT_FOUND':
    case 'RECIPE_NOT_FOUND':
    case 'MEAL_PLAN_NOT_FOUND':
    case 'HOUSEHOLD_NOT_FOUND':
    case 'USER_NOT_FOUND':
    case 'SESSION_NOT_FOUND':
    case 'PANTRY_ITEM_NOT_FOUND':
    case 'SHOPPING_LIST_NOT_FOUND':
    case 'PREFERENCE_NOT_FOUND':
    case 'NUTRITION_PROFILE_NOT_FOUND':
      return 'Resource not found';
    case 'CONFLICT':
      return 'Resource conflict';
    case 'RATE_LIMITED':
      return 'Too many requests';
    case 'JOB_FAILED':
      return 'Job failed';
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
