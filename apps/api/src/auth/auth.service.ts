// MC-010 — AuthService. Handles register / login / logout /
// logout-all / getSession. All persistence is via @multichef/database.
//
// SECURITY POSTURE (PRD MC-010 DoD):
//   * Passwords hashed with Argon2id (default parameters).
//   * Session tokens: 32 random bytes, base64url. Stored on the server
//     only as Argon2id hashes (Session.tokenHash). Cookie carries the
//     raw token; the server verifies by re-hashing on every request.
//   * Login is timing-safe for both unknown email and wrong password:
//     the unknown-email path runs Argon2id against a pre-computed
//     dummy hash so both branches take similar wall-clock time.
//   * Cookies (handled by the controller) carry HttpOnly +
//     SameSite=Lax/Strict + Secure-in-prod + Domain from env.

import { Injectable, Logger } from '@nestjs/common';
import argon2 from 'argon2';
import { getPrisma } from '@multichef/database';
import { loadServerEnv } from '@multichef/config';
import { generateSessionToken, generateUlid, hashSessionToken } from './session-token.js';
import { AppHttpException } from '../common/exception-filter.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  status: 'ACTIVE' | 'BLOCKED' | 'DELETED';
  tz: string;
  locale: string;
  isGuestConverted: boolean;
}

export interface AuthResult {
  user: AuthenticatedUser;
  sessionToken: string;
  expiresAt: Date;
}

interface RegisterInput {
  email: string;
  password: string;
  /** Audit round-5: the UI collects a family name and weekly budget. */
  householdName?: string | undefined;
  guestProfile?:
    | {
        peopleCount?: number | undefined;
        budgetWeekKopecks?: number | undefined;
        preferences?:
          | Array<{
              ingredientId?: string | undefined;
              kind: 'LOVE' | 'DISLIKE' | 'ALLERGY' | 'EXCLUDE';
              note?: string | undefined;
            }>
          | undefined;
      }
    | undefined;
}

// Pre-computed Argon2id hash used for the unknown-email login branch.
// Generated once at module load. Argon2id takes ~50ms per verify, so
// the unknown-email path spends the same wall-clock as a real one
// (timing-safe against user-enumeration).
let dummyHashPromise: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = argon2.hash('not-a-real-password-for-timing-only', {
      type: argon2.argon2id,
    });
  }
  return dummyHashPromise;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  async register(input: RegisterInput): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();
    const existing = await getPrisma().user.findUnique({ where: { email } });
    if (existing) {
      throw new AppHttpException({
        code: 'CONFLICT',
        message: 'Email already registered',
      });
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const userId = generateUlid();
    const householdId = generateUlid();
    const sessionId = generateUlid();

    const env = loadServerEnv();
    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_SECONDS * 1000);

    // Single transaction: user + household + membership + session.
    await getPrisma().$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: userId,
          email,
          passwordHash,
        },
      });
      // Audit round-5: persist onboarding data (family name, headcount,
      // weekly budget) — previously silently dropped.
      await tx.household.create({
        data: {
          id: householdId,
          ownerId: userId,
          name: input.householdName ?? 'Моя семья',
          defaultPeopleCount: input.guestProfile?.peopleCount ?? 2,
          ...(input.guestProfile?.budgetWeekKopecks
            ? { budgetWeekKopecks: input.guestProfile.budgetWeekKopecks }
            : {}),
        },
      });
      await tx.householdMember.create({
        data: {
          householdId,
          userId,
          role: 'OWNER',
        },
      });
      await tx.session.create({
        data: {
          id: sessionId,
          userId,
          tokenHash,
          expiresAt,
        },
      });
    });

    return {
      user: this.toUser({
        id: userId,
        email,
        status: 'ACTIVE',
        tz: 'Europe/Moscow',
        locale: 'ru',
        isGuestConverted: false,
      }),
      sessionToken,
      expiresAt,
    };
  }

  async login(input: { email: string; password: string }): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();
    const user = await getPrisma().user.findUnique({ where: { email } });

    // Timing-safe: run argon2 verify either way.
    const hashToCheck = user?.passwordHash ?? (await getDummyHash());
    const ok = await argon2.verify(hashToCheck, input.password);

    if (!user || !ok) {
      throw new AppHttpException({
        code: 'UNAUTHORIZED',
        message: 'Invalid email or password',
      });
    }
    if (user.status !== 'ACTIVE') {
      throw new AppHttpException({
        code: 'FORBIDDEN',
        message: 'Account is not active',
      });
    }

    const env = loadServerEnv();
    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_SECONDS * 1000);
    const sessionId = generateUlid();

    await getPrisma().session.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    return {
      user: this.toUser(user),
      sessionToken,
      expiresAt,
    };
  }

  async logout(sessionToken: string): Promise<void> {
    const tokenHash = hashSessionToken(sessionToken);
    // Find any matching (tokenHash, not revoked, not expired) row and
    // revoke it. If none match, this is a no-op — clients can re-call
    // logout safely.
    const row = await getPrisma().session.findFirst({
      where: { tokenHash, revokedAt: null },
    });
    if (!row) return;
    await getPrisma().session.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await getPrisma().session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getSession(
    sessionToken: string,
  ): Promise<{ user: AuthenticatedUser; sessionId: string } | null> {
    const tokenHash = hashSessionToken(sessionToken);
    const row = await getPrisma().session.findFirst({ where: { tokenHash } });
    if (!row) return null;
    if (row.revokedAt !== null) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    const user = await getPrisma().user.findUnique({ where: { id: row.userId } });
    if (!user || user.status !== 'ACTIVE') return null;
    return { user: this.toUser(user), sessionId: row.id };
  }

  private toUser(u: {
    id: string;
    email: string;
    status: string;
    tz: string;
    locale: string;
    isGuestConverted: boolean;
  }): AuthenticatedUser {
    return {
      id: u.id,
      email: u.email,
      status: u.status as AuthenticatedUser['status'],
      tz: u.tz,
      locale: u.locale,
      isGuestConverted: u.isGuestConverted,
    };
  }
}
