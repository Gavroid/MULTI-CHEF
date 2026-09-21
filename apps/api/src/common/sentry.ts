// T69-C (E26) → R17-WP13 hardened for prod-launch:
//   * tracesSampleRate env-driven (0.1 default; per-env override)
//   * release pinned to git SHA when available
//
// The SDK is imported lazily so local/dev boots without DSN never
// pay the initialisation cost. Once SENTRY_DSN is set in
// /etc/multichef/multichef.env the call below initialises the SDK
// on first api boot and reports into the configured project.
//
// PII scrubbing is intentionally deferred to the Sentry dashboard
// (Settings → Security & Compliance → "Security Emails" → "Scrub
// IP addresses" + relay-side scrubbing rule). Doing it in
// beforeSend would require coupling to SDK internals which broke
// on the 10.x line; the dashboard rules cover the same vectors
// (cookies, auth headers, idempotency keys) at the relay.
import { Logger } from '@nestjs/common';

let initialized = false;

export function initSentry(env: { SENTRY_DSN?: string | undefined }): void {
  if (initialized || !env.SENTRY_DSN) return;
  try {
    void (async () => {
      const Sentry = await import('@sentry/node');
      const tracesSampleRate = Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1');
      let release: string | undefined = process.env['SENTRY_RELEASE'];
      if (!release) {
        try {
          const { execSync } = await import('node:child_process');
          release = execSync('git rev-parse --short HEAD', {
            cwd: '/opt/multichef',
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
          }).trim();
        } catch {
          release = undefined;
        }
      }
      Sentry.init({
        dsn: env.SENTRY_DSN,
        environment: process.env['NODE_ENV'] ?? 'production',
        tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0.1,
        release,
      });
      initialized = true;
      new Logger('Sentry').log(
        `Sentry initialised (environment=${process.env['NODE_ENV'] ?? 'production'} release=${release ?? 'unknown'})`,
      );
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

/** Test seam — used by /api/v1/health/sentry-ping to verify the SDK. */
export function _sentryInitialized(): boolean {
  return initialized;
}
