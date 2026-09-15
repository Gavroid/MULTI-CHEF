// rescue-session — sessionStorage hand-off for /fridge/rescue (MC-040).
//
// Same pattern as MC-034's /today result hand-off (LoadingClient): the
// loading step stores the response under `mc-rescue-<ref>` and the
// result step reads it back by ?resultRef=. TTL 30 min, expired or
// corrupt entries read as null (→ redirect back to the picker).

import type { RescueResponseDto } from '@multichef/contracts';

export const RESCUE_TTL_MS = 30 * 60_000;

export interface RescueSession {
  result: RescueResponseDto;
  createdAt: number;
}

/** UUID v4 with a fallback for runtimes without crypto.randomUUID. */
function newRef(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(36))
    .join('')
    .slice(0, 12);
}

export function saveRescueSession(
  result: RescueResponseDto,
  sessionStorageImpl: Storage = window.sessionStorage,
): string {
  const ref = newRef();
  sessionStorageImpl.setItem(
    `mc-rescue-${ref}`,
    JSON.stringify({ result, createdAt: Date.now() } satisfies RescueSession),
  );
  return ref;
}

export function loadRescueSession(
  ref: string | null,
  sessionStorageImpl: Storage = window.sessionStorage,
): RescueSession | null {
  if (!ref) return null;
  const raw = sessionStorageImpl.getItem(`mc-rescue-${ref}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RescueSession;
    if (Date.now() - parsed.createdAt > RESCUE_TTL_MS) {
      sessionStorageImpl.removeItem(`mc-rescue-${ref}`);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
