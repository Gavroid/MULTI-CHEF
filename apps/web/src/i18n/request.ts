// T46-B (E23): next-intl request config for the App Router. The product
// ships ru-only UI (PRD) without locale routing, so the request locale
// is pinned to 'ru'; User.locale drives API error language instead.
import { getRequestConfig } from 'next-intl/server';
import ru from './ru';

export default getRequestConfig(async () => ({
  locale: 'ru' as const,
  messages: ru,
}));
