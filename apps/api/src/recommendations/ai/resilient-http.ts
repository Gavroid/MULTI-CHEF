// T69-A (E26): resilient HTTP client for external calls — timeout,
// bounded exponential-backoff retries (429/5xx/network), and a
// circuit-breaker (open after N consecutive failures, half-open probe
// after the cooldown). Zero deps; injectable fetch for tests.

export interface ResilientHttpOptions {
  timeoutMs: number;
  maxRetries: number;
  /** Consecutive failures before the breaker opens. */
  breakerThreshold: number;
  /** Ms the breaker stays open before a half-open probe. */
  breakerCooldownMs: number;
  fetchImpl?: typeof fetch;
}

export class CircuitOpenError extends Error {
  readonly code = 'CIRCUIT_OPEN';
  constructor() {
    super('circuit breaker is open');
  }
}

type BreakerState = { failures: number; openedAt: number | null };

export class ResilientHttp {
  private readonly breaker: BreakerState = { failures: 0, openedAt: null };

  constructor(private readonly options: ResilientHttpOptions) {}

  private breakerOpen(): boolean {
    if (this.breaker.openedAt === null) return false;
    if (Date.now() - this.breaker.openedAt >= this.options.breakerCooldownMs) {
      // half-open: allow one probe through
      return false;
    }
    return true;
  }

  private onSuccess(): void {
    this.breaker.failures = 0;
    this.breaker.openedAt = null;
  }

  private onFailure(): void {
    this.breaker.failures += 1;
    if (this.breaker.failures >= this.options.breakerThreshold) {
      this.breaker.openedAt = Date.now();
    }
  }

  /**
   * POST JSON with timeout + retries. Retries only 429/5xx/network
   * errors with exponential backoff (0.5s base); other statuses pass
   * through. Throws CircuitOpenError while the breaker is open.
   */
  async postJson(
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<{ status: number; json: unknown }> {
    if (this.breakerOpen()) throw new CircuitOpenError();
    const doFetch = this.options.fetchImpl ?? fetch;
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      const signal = AbortSignal.timeout(this.options.timeoutMs);
      try {
        const res = await doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(body),
          signal,
        });
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`upstream ${res.status}`);
          this.onFailure();
          if (attempt < this.options.maxRetries) {
            await sleep(500 * 2 ** attempt);
            continue;
          }
          break;
        }
        this.onSuccess();
        const json = await res.json().catch(() => null);
        return { status: res.status, json };
      } catch (err) {
        if (err instanceof CircuitOpenError) throw err;
        lastError = err;
        this.onFailure();
        if (attempt < this.options.maxRetries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('upstream failed');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
