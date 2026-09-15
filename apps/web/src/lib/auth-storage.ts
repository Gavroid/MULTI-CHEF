// auth-storage — localStorage helpers for the client-side user marker.
//
// mc_session is an HttpOnly cookie set by the server. The browser cannot
// read it, so we mirror a small non-secret summary into localStorage so
// the client UI (BottomTabBar highlighting, AuthGuard) can react to
// "logged in" state without an extra round-trip.
//
// What's stored: { id, email, householdId } — enough to label the UI and
// to invalidate client state on logout. NEVER store the session token
// or password.

import type { AuthUser } from './auth-client.js';

const STORAGE_KEY = 'mc_user';

export interface StoredUser {
  id: string;
  email: string;
  householdId: string;
  /** T46-C/T46-D (E23): optional — older stored markers lack them. */
  locale?: string | undefined;
  tz?: string | undefined;
}

export function saveLocalUser(user: AuthUser, household: { id: string }): StoredUser {
  const stored: StoredUser = {
    id: user.id,
    email: user.email,
    householdId: household.id,
    locale: user.locale,
    tz: user.tz,
  };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // localStorage blocked — ignore. Login still worked (cookie set).
    }
  }
  return stored;
}

export function readLocalUser(): StoredUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredUser>;
    if (
      typeof parsed.id === 'string' &&
      typeof parsed.email === 'string' &&
      typeof parsed.householdId === 'string'
    ) {
      return {
        id: parsed.id,
        email: parsed.email,
        householdId: parsed.householdId,
        locale: typeof parsed.locale === 'string' ? parsed.locale : undefined,
        tz: typeof parsed.tz === 'string' ? parsed.tz : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearLocalUser(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function hasLocalUser(): boolean {
  return readLocalUser() !== null;
}
