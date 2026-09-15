// expiry — pure helpers for human-friendly expiration labels.
//
// Backend returns ISO dates (YYYY-MM-DD) for PantryItem.expiresAt.
// The mobile UI shows compact Russian labels so a list of 30
// PantryItems stays scannable: "До 31 дек", "Истёк 5 дней назад",
// "Нет срока".

import { DEFAULT_TZ, todayInTz } from './datetime';
import type { PantryItem } from './pantry-client';

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];

export type ExpiryTone = 'neutral' | 'warning' | 'danger' | 'muted';

export interface ExpiryLabel {
  /** Short text shown next to the PantryItem name, e.g. "До 31 дек". */
  text: string;
  /** Tone drives the colour chip (neutral / warning / danger / muted). */
  tone: ExpiryTone;
  /** Numeric days remaining (negative = days expired). Null if no date. */
  daysRemaining: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Start-of-day comparison: the backend stores YYYY-MM-DD as midnight
 * UTC, so we work in UTC to avoid TZ drift. `today` is computed in the
 * USER's timezone (T46-D) — 'Europe/Moscow' default — not the browser's,
 * so "days until expiry" rolls over at the user's local midnight.
 * Callers should pass a `now` for deterministic tests.
 */
export function formatExpiry(
  isoDate: string | null | undefined,
  now: Date = new Date(),
  tz: string = DEFAULT_TZ,
): ExpiryLabel {
  if (!isoDate) {
    return { text: 'Нет срока', tone: 'muted', daysRemaining: null };
  }
  // The API returns a date-only string. Parse as UTC midnight so the
  // diff is a whole number of days regardless of viewer's TZ.
  const [yearStr, monthStr, dayStr] = isoDate.split('-');
  const y = Number(yearStr);
  const m = Number(monthStr);
  const d = Number(dayStr);
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d) ||
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > 31
  ) {
    return { text: 'Нет срока', tone: 'muted', daysRemaining: null };
  }
  const expiryUtc = Date.UTC(y, m - 1, d);
  const [ty, tm, td] = todayInTz(tz, now).split('-').map(Number);
  const nowUtc = Date.UTC(ty!, tm! - 1, td!);
  const days = Math.round((expiryUtc - nowUtc) / MS_PER_DAY);

  if (days < 0) {
    const n = -days;
    const plural = pluralRu(n, 'день', 'дня', 'дней');
    return {
      text: `Истёк ${n} ${plural} назад`,
      tone: 'danger',
      daysRemaining: days,
    };
  }
  if (days === 0) {
    return { text: 'Годен до сегодня', tone: 'warning', daysRemaining: 0 };
  }
  if (days <= 3) {
    return {
      text: `До ${dayStr} ${MONTHS_GENITIVE[m - 1] ?? ''}`,
      tone: 'warning',
      daysRemaining: days,
    };
  }
  return {
    text: `До ${dayStr} ${MONTHS_SHORT[m - 1] ?? ''}`,
    tone: 'neutral',
    daysRemaining: days,
  };
}

/**
 * Stable ordering for the fridge list: items with the closest
 * expiryAt float to the top, items without an expiry sink to the
 * bottom (ordered by createdAt desc as a tiebreaker).
 */
export function comparePantryItems(a: PantryItem, b: PantryItem): number {
  const ax = a.expiresAt ? Date.parse(a.expiresAt) : Number.POSITIVE_INFINITY;
  const bx = b.expiresAt ? Date.parse(b.expiresAt) : Number.POSITIVE_INFINITY;
  if (ax !== bx) return ax - bx;
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}

/**
 * Group a list into "expiring" (≤7 days or already expired) and
 * "fresh" buckets. Each bucket is sorted in-place: expiring by
 * urgency (closest expiry first, past dates sink further down),
 * fresh by creation date (newest first). The UI shows two stacked
 * sections.
 */
export function partitionByExpiry(
  items: readonly PantryItem[],
  now: Date = new Date(),
): { expiring: PantryItem[]; fresh: PantryItem[] } {
  const expiring: PantryItem[] = [];
  const fresh: PantryItem[] = [];
  for (const item of items) {
    const label = formatExpiry(item.expiresAt, now);
    const days = label.daysRemaining;
    if (days === null) {
      fresh.push(item);
    } else if (days <= 7) {
      expiring.push(item);
    } else {
      fresh.push(item);
    }
  }
  expiring.sort(comparePantryItems);
  fresh.sort(comparePantryItems);
  return { expiring, fresh };
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
