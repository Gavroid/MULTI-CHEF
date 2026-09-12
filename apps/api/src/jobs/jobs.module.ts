// MC-050 — Jobs module wiring.

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';
import { createQueuePublisher } from './queue-publisher.js';

@Module({
  imports: [AuthModule],
  controllers: [JobsController],
  providers: [JobsService, { provide: 'QueuePublisher', useFactory: createQueuePublisher }],
  exports: [JobsService],
})
export class JobsModule {}
