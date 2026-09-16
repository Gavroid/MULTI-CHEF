// T69-D (E26): inbound webhook scaffold. Contract (docs/api/webhooks.md):
//   POST /webhooks/inbound
//   X-MC-Signature: sha256=<hex hmac-sha256 of the RAW body>
//   X-MC-Event-Id: <unique event id>          (idempotent per id)
//   body: {"id":"<evt id>","type":"<domain.event>","occurredAt":"<iso>","data":{...}}
// Handlers register in EVENTS; unknown types ack (200) so senders do not
// retry storms, logged for follow-up.
import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookEvent {
  id: string;
  type: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

export type WebhookHandler = (event: WebhookEvent) => void | Promise<void>;

export function signPayload(secret: string, rawBody: Buffer | string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

export function verifySignature(
  secret: string,
  rawBody: Buffer | string,
  header: string | undefined,
): boolean {
  if (!header) return false;
  const expected = Buffer.from(signPayload(secret, rawBody));
  const given = Buffer.from(header);
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger('WebhooksService');
  /** Registry — new integrations add entries instead of new endpoints. */
  private readonly handlers = new Map<string, WebhookHandler>();
  /** In-memory event-id dedup (single instance; Redis when scaled out). */
  private readonly seen = new Set<string>();

  register(type: string, handler: WebhookHandler): void {
    this.handlers.set(type, handler);
  }

  /** Returns true when the event id was unseen (false = replay). */
  claimEventId(id: string): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    // bound the set: 10k ids is plenty for one process lifetime
    if (this.seen.size > 10_000) {
      const first = this.seen.values().next().value;
      if (first !== undefined) this.seen.delete(first);
    }
    return true;
  }

  async dispatch(event: WebhookEvent): Promise<{ handled: boolean }> {
    const handler = this.handlers.get(event.type);
    if (!handler) {
      this.logger.log(`webhook ${event.type} received (no handler) — acked`);
      return { handled: false };
    }
    await handler(event);
    return { handled: true };
  }
}
