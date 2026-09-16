// T69-D (E26): webhook receiver wiring. New integrations register
// handlers in WebhooksService instead of adding endpoints.
import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';

@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
