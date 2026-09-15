// T37-C/T55-D (audit rounds 37/55): единственный источник публичного
// origin сайта. До этого 4 файла дублировали
// process.env[NEXT_PUBLIC_APP_BASE_URL] со своим fallback — дефолты
// рассинхронизировались.
import { getApiBaseUrl } from './env';

export function getSiteUrl(): string {
  return getApiBaseUrl();
}
