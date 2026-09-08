// Shared env helpers.
// Reused by both env.server.ts (API) and env.web.ts (web) to keep the
// URL / port / log-level parsing consistent.

import { z } from 'zod';

// Trim trailing whitespace + null bytes from env strings. Some shells
// (and CI matrix runners) inject trailing newlines that zod's
// `.min(1)` happily accepts as "set" — but the actual cookie secret
// parser would barf.
export const trimEnvString = (value: unknown): unknown =>
  typeof value === 'string' ? value.replace(/[\r\n\t\v\f\0]+/g, '').trim() : value;
const optionalString = z.preprocess(trimEnvString, z.string().min(1).optional());

// Numeric port: positive integer, 1-65535. Coerced from env string.
const portSchema = z.coerce.number().int().min(1).max(65535);

// URL parser that requires an explicit protocol and host.
const urlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'URL must use http:// or https://');

// Postgres URL parser — must use the postgresql:// scheme.
const postgresUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith('postgresql://'), 'DATABASE_URL must use postgresql://');

// Redis URL parser — redis:// or rediss://
const redisUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => value.startsWith('redis://') || value.startsWith('rediss://'),
    'REDIS_URL must use redis:// or rediss://',
  );

const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
const logFormatSchema = z.enum(['json', 'pretty']);

const nodeEnvSchema = z.enum(['development', 'production', 'test']);

// Boolean coercion: "true" / "false" / "1" / "0" / "" → boolean.
const booleanFromString = z.union([z.boolean(), z.string()]).transform((value) => {
  if (typeof value === 'boolean') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === '') {
    return false;
  }
  return Boolean(value);
});

// Re-exported so tests + consumers don't have to import zod directly.
export {
  booleanFromString,
  logFormatSchema,
  logLevelSchema,
  nodeEnvSchema,
  optionalString,
  portSchema,
  postgresUrlSchema,
  redisUrlSchema,
  urlSchema,
};

// Schema for the SERVER side (apps/api + apps/worker).
// Anything in here is required to start the API.
export const serverEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  API_PORT: portSchema.default(3001),
  WEB_PORT: portSchema.default(3000),
  APP_BASE_URL: urlSchema.default('http://localhost:3001'),

  DATABASE_URL: postgresUrlSchema,
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  REDIS_URL: redisUrlSchema,
  REDIS_PASSWORD: optionalString,

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  COOKIE_SECURE: booleanFromString.default(false),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().min(1).default('localhost'),

  CORS_ORIGINS: z
    .string()
    .min(1)
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_AUTH_MAX_REQUESTS: z.coerce.number().int().positive().default(10),

  LOG_LEVEL: logLevelSchema.default('info'),
  LOG_FORMAT: logFormatSchema.default('pretty'),

  SENTRY_DSN: optionalString,
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  ANALYTICS_WRITE_KEY: optionalString,

  OPENAI_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

// Schema for the WEB side (apps/web). Most server-side keys are not
// exposed to the browser bundle — only those that the framework needs
// during build / dev.
export const webEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  WEB_PORT: portSchema.default(3000),
  APP_BASE_URL: urlSchema.default('http://localhost:3001'),

  // Public-side keys. Only NEXT_PUBLIC_* should be passed to the browser
  // via env at runtime; this schema is the entry point for build-time
  // checks.
  NEXT_PUBLIC_APP_BASE_URL: urlSchema.default('http://localhost:3001'),

  LOG_LEVEL: logLevelSchema.default('info'),
  LOG_FORMAT: logFormatSchema.default('pretty'),
});

export type WebEnv = z.infer<typeof webEnvSchema>;
