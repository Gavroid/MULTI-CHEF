// Public API of @multichef/config.
//
// Usage:
//   import { loadServerEnv, loadWebEnv } from '@multichef/config';
//
//   const env = loadServerEnv(); // throws ZodError with a friendly
//                               // message if anything is missing/invalid
//   console.log(env.API_PORT);
//
// MC-002: the schema lives in `env.schema.ts`. The loader here is a thin
// wrapper that does (1) collect process.env, (2) parse via Zod, and
// (3) format errors so the API fails fast at boot with a useful trace.

import {
  serverEnvSchema,
  webEnvSchema,
  type ServerEnv,
  type WebEnv,
  trimEnvString,
} from './env.schema.js';

export type { ServerEnv, WebEnv } from './env.schema.js';
export {
  serverEnvSchema,
  webEnvSchema,
  booleanFromString,
  logFormatSchema,
  logLevelSchema,
  nodeEnvSchema,
  optionalString,
  portSchema,
  postgresUrlSchema,
  redisUrlSchema,
  trimEnvString,
  urlSchema,
} from './env.schema.js';

export class EnvValidationError extends Error {
  public override readonly name = 'EnvValidationError';
  public readonly issues: ReadonlyArray<{ path: string; message: string }>;
  constructor(message: string, issues: ReadonlyArray<{ path: string; message: string }>) {
    super(message);
    this.issues = issues;
  }
}

function formatZodIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>,
): Array<{ path: string; message: string }> {
  return issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

function buildErrorMessage(
  label: string,
  issues: ReadonlyArray<{ path: string; message: string }>,
): string {
  const lines = [`@multichef/config: ${label} failed validation.`];
  lines.push('Fix the following environment variables and try again:');
  for (const issue of issues) {
    lines.push(`  - ${issue.path}: ${issue.message}`);
  }
  lines.push('See .env.example at the repo root for the full list of required and optional keys.');
  return lines.join('\n');
}

export interface LoadServerEnvOptions {
  /** Override process.env (handy for tests). Defaults to process.env. */
  readonly source?: Record<string, string | undefined>;
  /** Override NODE_ENV at parse time without mutating the host env. */
  readonly nodeEnv?: ServerEnv['NODE_ENV'];
}

/** Parse + validate the server-side env. Throws EnvValidationError on failure. */
export function loadServerEnv(options: LoadServerEnvOptions = {}): ServerEnv {
  const source = options.source ?? process.env;
  const candidate: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    candidate[key] = trimEnvString(value);
  }
  if (options.nodeEnv !== undefined) {
    candidate['NODE_ENV'] = options.nodeEnv;
  }

  const result = serverEnvSchema.safeParse(candidate);
  if (!result.success) {
    throw new EnvValidationError(
      buildErrorMessage('serverEnv', formatZodIssues(result.error.issues)),
      formatZodIssues(result.error.issues),
    );
  }
  return result.data;
}

export interface LoadWebEnvOptions {
  readonly source?: Record<string, string | undefined>;
  readonly nodeEnv?: WebEnv['NODE_ENV'];
}

/** Parse + validate the web-side env. Throws EnvValidationError on failure. */
export function loadWebEnv(options: LoadWebEnvOptions = {}): WebEnv {
  const source = options.source ?? process.env;
  const candidate: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    candidate[key] = trimEnvString(value);
  }
  if (options.nodeEnv !== undefined) {
    candidate['NODE_ENV'] = options.nodeEnv;
  }

  const result = webEnvSchema.safeParse(candidate);
  if (!result.success) {
    throw new EnvValidationError(
      buildErrorMessage('webEnv', formatZodIssues(result.error.issues)),
      formatZodIssues(result.error.issues),
    );
  }
  return result.data;
}

/**
 * Parse + validate, returning a discriminated union instead of throwing.
 * Useful for contexts where throwing is not appropriate (e.g. CLI tools).
 */
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: EnvValidationError };

export function parseServerEnv(
  source: Record<string, string | undefined> = process.env,
): ParseResult<ServerEnv> {
  const candidate: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    candidate[key] = trimEnvString(value);
  }
  const result = serverEnvSchema.safeParse(candidate);
  if (!result.success) {
    return {
      ok: false,
      error: new EnvValidationError(
        buildErrorMessage('serverEnv', formatZodIssues(result.error.issues)),
        formatZodIssues(result.error.issues),
      ),
    };
  }
  return { ok: true, value: result.data };
}

export function parseWebEnv(
  source: Record<string, string | undefined> = process.env,
): ParseResult<WebEnv> {
  const candidate: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    candidate[key] = trimEnvString(value);
  }
  const result = webEnvSchema.safeParse(candidate);
  if (!result.success) {
    return {
      ok: false,
      error: new EnvValidationError(
        buildErrorMessage('webEnv', formatZodIssues(result.error.issues)),
        formatZodIssues(result.error.issues),
      ),
    };
  }
  return { ok: true, value: result.data };
}
