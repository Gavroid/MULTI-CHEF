// MC-101 (Audit R15) / MC-103 (Audit R16) — Zod-based validation pipe.
//
// Why a custom pipe (not `nestjs-zod`'s ZodValidationPipe): nestjs-zod
// imports rxjs, and pnpm's nested-store layout does not hoist rxjs into
// the nestjs-zod sub-package's node_modules on this install. Trying to
// `require('nestjs-zod')` at runtime throws MODULE_NOT_FOUND. This pipe
// only depends on `@nestjs/common` + `zod`, both of which ARE in
// apps/api/node_modules — it stays inside the project's own resolution
// tree and works under pnpm without any extra hoisting config.
//
// MC-103 (Audit R16) — explicit-schema pipe variant.
//
//   The MC-101 approach read the Zod schema off the DTO class as a
//   *static field* (`metatype.schema` populated by `createZodDto`).
//   In NestJS 11 + Fastify this is unreliable: the @Body() pipe fires
//   but `metadata.metatype` is sometimes `Object` / `Function` instead
//   of the DTO class, so the static lookup misses. Symptom: malformed
//   bodies (e.g. `email: "not-an-email"`) reach the service and either
//   crash with TypeError or are persisted as-is.
//
//   The fix: pass the schema *explicitly* to the pipe via the
//   constructor — `@Body(new ZodValidationPipe(RegisterBody))`. The
//   pipe no longer relies on `metadata.metatype` for schema discovery;
//   it uses the schema passed at construction time. The metatype
//   static-field lookup is kept as a fallback for callers that still
//   use `@Body(new ZodValidationPipe())` (no schema).
//
//   See docs/decisions/ADR-0024-zod-validation-strategy.md for the
//   full rationale and the decision to keep MC-102 service guards
//   even after MC-103 closes (defense in depth).

import {
  BadRequestException,
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';
import type { ZodTypeAny } from 'zod';

interface ZodDtoConstructor {
  isZodDto?: boolean;
  schema?: ZodTypeAny;
}

@Injectable()
export class ZodValidationPipe implements PipeTransform<unknown, unknown> {
  constructor(private readonly explicitSchema?: ZodTypeAny) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== 'body') {
      return value;
    }

    let schema: ZodTypeAny | undefined = this.explicitSchema;

    // Fallback: static field on the DTO class (MC-101 legacy path).
    if (!schema) {
      const metatype = metadata.metatype as ZodDtoConstructor | undefined;
      if (metatype?.isZodDto && metatype.schema) {
        schema = metatype.schema;
      }
    }

    if (!schema) {
      // No schema resolved — let downstream handle it. MC-102 service
      // guards are the safety net for endpoints without Zod coverage.
      return value;
    }

    const result = schema.safeParse(value);
    if (!result.success) {
      const fields: Record<string, string[]> = {};
      for (const issue of result.error.issues) {
        const path = issue.path.length > 0 ? issue.path.join('.') : '_';
        (fields[path] ??= []).push(issue.message);
      }
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Ошибка валидации запроса',
        details: { fields },
      });
    }
    return result.data;
  }
}
