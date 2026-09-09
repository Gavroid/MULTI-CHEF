// Redirect-target parser for /auth/login.
//
// Defensive against open-redirect: we only accept same-origin paths
// (start with `/`, not `//` or `https://…`). Returns null for anything
// else so the caller falls back to the default landing page.

export function sanitizeRedirect(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  return raw;
}
