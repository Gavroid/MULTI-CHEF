// T69-C (E26): Sentry bootstrap — no-op unless SENTRY_DSN is set. The
// SDK is imported lazily so local/dev boots without the DSN never pay
// the initialisation cost. Sampling is intentionally minimal until a
// staging project exists.
import { Logger } from '@nestjs/common';

let initialized = false;

export function initSentry(env: { SENTRY_DSN?: string | undefined }): void {
  if (initialized || !env.SENTRY_DSN) return;
  try {
    void (async () => {
      const Sentry = await import('@sentry/node');
      Sentry.init({
        dsn: env.SENTRY_DSN,
        environment: process.env['NODE_ENV'] ?? 'development',
        tracesSampleRate: 0,
      });
      initialized = true;
      new Logger('Sentry').log('Sentry initialised (SENTRY_DSN present)');
    })();
  } catch {
    // never let observability break boot
  }
}

/** Capture an exception once Sentry is initialised; safe everywhere. */
export function captureException(err: unknown): void {
  if (!initialized) return;
  void (async () => {
    try {
      const Sentry = await import('@sentry/node');
      Sentry.captureException(err);
    } catch {
      // ignore
    }
  })();
}
