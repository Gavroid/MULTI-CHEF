// MC-101 (Audit R15) — Minimal Zod-based validation pipe.
//
// Why a custom pipe (not `nestjs-zod`'s ZodValidationPipe): nestjs-zod
// imports rxjs, and pnpm's nested-store layout does not hoist rxjs into
// the nestjs-zod sub-package's node_modules on this install. Trying to
// `require('nestjs-zod')` at runtime throws MODULE_NOT_FOUND. This pipe
// only depends on `@nestjs/common` + `zod`, both of which ARE in
// apps/api/node_modules — it stays inside the project's own resolution
// tree and works under pnpm without any extra hoisting config.
//
// Behaviour:
//   - Reads the DTO class from the parameter metadata.
//   - Detects the Zod schema from `createZodDto(Schema)`'s static
//     `zodSchema` field (the same shape nestjs-zod exposes).
//   - On success: replaces the body with the parsed value (Zod's
//     `parse` returns the typed object — no `any`).
//   - On failure: throws BadRequestException with a structured
//     VALIDATION_ERROR envelope identical to the existing AppHttpException
//     shape so clients don't see two different error formats.

import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import type { ZodTypeAny } from 'zod';

interface ZodDtoConstructor {
  isZodDto?: boolean;
  schema?: ZodTypeAny;
}

@Injectable()
export class ZodValidationPipe implements PipeTransform<unknown, unknown> {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== 'body') {
      return value;
    }
    const metatype = metadata.metatype as ZodDtoConstructor | undefined;
    if (!metatype?.isZodDto) {
      // Not a Zod DTO — let downstream handle it (raw body, plain class).
      return value;
    }
    const schema = metatype.schema;
    if (!schema) {
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
