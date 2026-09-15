// T13-A / T14-A follow-up (prod smoke, 2026-09-14): Prisma reports
// P2002 targets with quoted identifiers for camelCase columns —
// meta.target can look like ['"userId"', 'kind', '"ingredientId"'].
// Matching the bare field name with Array.includes silently fails,
// which turned the intended 409 mapping back into a 500 under real
// concurrency. Always compare quote-stripped values.

import { Prisma } from '@prisma/client';
import { AppHttpException } from './exception-filter.js';

/**
 * True when the caught error is Prisma's unique-constraint violation
 * (P2002) whose target list contains `field` (quote-insensitive).
 */
export function isUniqueConstraintOn(err: unknown, field: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    Array.isArray(err.meta?.['target']) &&
    (err.meta['target'] as unknown[]).some((t) => String(t).replace(/"/g, '') === field)
  );
}

// T64-D (audit round 64): map known Prisma failure codes onto the API
// error contract instead of leaking 500s. `field` — the DTO name the
// caller was operating on (used in details).
export function prismaErrorToHttp(err: unknown, field: string): AppHttpException | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null;
  switch (err.code) {
    case 'P2002':
      return new AppHttpException({ code: 'CONFLICT', message: 'Запись уже существует' });
    case 'P2025':
      return new AppHttpException({
        code: 'NOT_FOUND',
        message: 'Запись не найдена',
        details: { field },
      });
    case 'P2003':
      return new AppHttpException({
        code: 'CONFLICT',
        message: 'Запись связана с другими данными',
        details: { field },
      });
    case 'P2014':
      return new AppHttpException({
        code: 'CONFLICT',
        message: 'Изменение нарушило бы связь между записями',
        details: { field },
      });
    default:
      return null;
  }
}
