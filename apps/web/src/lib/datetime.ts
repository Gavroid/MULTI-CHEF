// T46-D (E23): timezone-aware date helpers. User.tz (schema default
// 'Europe/Moscow') must drive which calendar day "today" is and how
// absolute dates render — never the server's or browser's local zone.

/** Schema default for User.tz (packages/database/prisma/schema.prisma). */
export const DEFAULT_TZ = 'Europe/Moscow';
export const DEFAULT_LOCALE = 'ru';

/**
 * The calendar date (YYYY-MM-DD) it is RIGHT NOW in the given IANA zone.
 * Uses Intl so DST transitions are handled by the platform tables.
 */
export function todayInTz(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  // 'sv-SE' formats an ISO-like YYYY-MM-DD date for every timezone.
  return new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(now);
}

/** Format an instant as a locale-aware date in the given zone. */
export function formatDateInTz(
  date: Date,
  locale: string = DEFAULT_LOCALE,
  tz: string = DEFAULT_TZ,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}
