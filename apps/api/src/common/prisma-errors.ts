// T13-A / T14-A follow-up (prod smoke, 2026-09-14): Prisma reports
// P2002 targets with quoted identifiers for camelCase columns —
// meta.target can look like ['"userId"', 'kind', '"ingredientId"'].
// Matching the bare field name with Array.includes silently fails,
// which turned the intended 409 mapping back into a 500 under real
// concurrency. Always compare quote-stripped values.

import { Prisma } from '@prisma/client';

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
