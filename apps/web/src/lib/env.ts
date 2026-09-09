// Centralised env var access for the web app. NEXT_PUBLIC_* vars are
// inlined at build time by Next.js; reading them at module scope gives
// us a single source of truth for the API base URL.

export function getApiBaseUrl(): string {
  // Default mirrors packages/config env.schema.ts (localhost:3001).
  // process.env['NEXT_PUBLIC_APP_BASE_URL'] is replaced statically by
  // Next.js for client bundles.
  return process.env['NEXT_PUBLIC_APP_BASE_URL'] ?? 'http://localhost:3001';
}
