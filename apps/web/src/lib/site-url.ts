// T37-C/T55-D (audit rounds 37/55): единственный источник публичного
// origin сайта. До этого 4 файла дублировали
// process.env[NEXT_PUBLIC_APP_BASE_URL] со своим fallback — дефолты
// рассинхронизировались.
import { getApiBaseUrl } from './env';

// MC-R21 (2026-09-30): getApiBaseUrl по умолчанию возвращает '' (same-origin
// режим для клиентских fetch). Но sitemap/robots/metadataBase — серверные
// потребители, которым нужен АБСОЛЮТНЫЙ URL (Next.js валидирует new URL()).
// Для них fallback — dev-origin; это серверный код и в клиентский бандл
// не попадает (bundle-guard в CI следит только за клиентскими чанками).
export function getSiteUrl(): string {
  const url = getApiBaseUrl();
  if (url !== '') return url;
  const port = process.env['WEB_PORT'] ?? '3000';
  return `http://localhost:${port}`;
}
