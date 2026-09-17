// MC-101 (Audit R15) — Auth DTO classes (audit-local ZodDto factory).
//
// Why we don't use nestjs-zod's `createZodDto` here:
//   nestjs-zod@4.3.1 imports rxjs at module top-level. The pnpm
//   nested-store layout on this install does NOT hoist rxjs into
//   nestjs-zod's sub-package node_modules, so `require('nestjs-zod')`
//   throws MODULE_NOT_FOUND for rxjs. That makes `RegisterDto`,
//   `LoginDto`, `LogoutDto`, `LocaleDto` undefined at runtime. The
//   global + per-param Zod pipes fire but `metatype.isZodDto` is null
//   and validation silently no-ops. Confirmed on prod .95 at 07:49 UTC
//   via console.log diagnostic.
//
// This local factory is API-compatible with nestjs-zod's createZodDto:
//   - returns a class with `static schema` and `static isZodDto = true`
//   - DTO instances have full TS type (inferred from the Zod schema)
//   - `static create(input)` parses via the schema
//   - has zero rxjs / reflect-metadata peer-dep.
//
// All other auth.dto.* (Zod schemas) are unchanged.

import type { z } from 'zod';
import { RegisterBody, LoginBody, LogoutBody, LocaleBody } from './auth.dto.js';

export interface ZodDto<T> {
  new (): T;
  isZodDto: true;
  schema: z.ZodTypeAny;
  create(input: unknown): T;
}

export function createZodDto<T>(schema: z.ZodType<T>): ZodDto<T> {
  class AugmentedZodDto {
    static create(input: unknown): T {
      return (this as unknown as { schema: z.ZodType<T> }).schema.parse(input);
    }
  }
  (AugmentedZodDto as unknown as { isZodDto: boolean }).isZodDto = true;
  (AugmentedZodDto as unknown as { schema: z.ZodTypeAny }).schema =
    schema as unknown as z.ZodTypeAny;
  return AugmentedZodDto as unknown as ZodDto<T>;
}

export type RegisterInput = z.infer<typeof RegisterBody>;
export type LoginInput = z.infer<typeof LoginBody>;
export type LogoutInput = z.infer<typeof LogoutBody>;
export type LocaleInput = z.infer<typeof LocaleBody>;

export class RegisterDto extends createZodDto<RegisterInput>(RegisterBody) {}
export class LoginDto extends createZodDto<LoginInput>(LoginBody) {}
export class LogoutDto extends createZodDto<LogoutInput>(LogoutBody) {}
export class LocaleDto extends createZodDto<LocaleInput>(LocaleBody) {}
