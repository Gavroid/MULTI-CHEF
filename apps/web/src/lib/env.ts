// Centralised env var access for the web app. NEXT_PUBLIC_* vars are
// inlined at build time by Next.js; reading them at module scope gives
// us a single source of truth for the API base URL.

// MC-R21 (2026-09-30): дефолт '' (same-origin) вместо 'http://localhost:3001'.
// Захардкоженный localhost в прод-бандле ломал ВСЕ клиентские API-вызовы:
// PWA на https://multi-chef.431a.ru фетчила http://localhost:3001 → «Нет
// соединения» (regression: бандл, собранный без NEXT_PUBLIC_APP_BASE_URL).
// Пустая строка => браузер ходит на свой origin (/api/v1/... через nginx),
// что корректно и в браузере, и в установленной PWA.
export function getApiBaseUrl(): string {
  // process.env['NEXT_PUBLIC_APP_BASE_URL'] заменяется статически Next.js
  // в клиентском бандле; undefined => same-origin режим.
  return process.env['NEXT_PUBLIC_APP_BASE_URL'] ?? '';
}
