// MC-010 session token utilities.
//
// A session token is a 32-byte random value encoded as base64url
// (no padding). It is at least 43 characters long and lives only in
// the cookie + the response body — never stored in plaintext on the
// server.
//
// The server stores a SHA-256 hash of the token in the Session.tokenHash
// column. PRD §3.2 explicitly says "Session в Postgres (храним SHA-256 от
// токена, не токен)". Argon2id is reserved for *user* passwords (where
// the dictionary-attack profile is real); session tokens are random
// 256-bit values whose effective entropy already exceeds the search
// space for brute-force, so SHA-256 is appropriate here (and keeps
// per-request verification at microsecond cost instead of tens of ms).

import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;

/**
 * Generate a 26-character ULID-style identifier. We use Node's
 * `crypto.randomBytes` and emit a hex (uppercase) string of the
 * appropriate length. Hex is a subset of the Crockford Base32 alphabet
 * the schema's ULID regex /^[0-9A-HJKMNP-TV-Z]{26}$/ expects (it
 * allows 0/1 which the strict ULID alphabet doesn't, but the regex
 * matches either). For an internal-only id this is fine — the schema
 * does not use Crockford's monotonic ordering semantics.
 */
export function generateUlid(): string {
  const buf = randomBytes(13);
  return buf.toString('hex').toUpperCase().padEnd(26, '0').slice(0, 26);
}

/** Generate a fresh, high-entropy session token. */
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Deterministic SHA-256 hash of a session token. The same token always
 * hashes to the same value, which lets us index the Session table on
 * `tokenHash` and look it up in O(1) on every authenticated request.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
