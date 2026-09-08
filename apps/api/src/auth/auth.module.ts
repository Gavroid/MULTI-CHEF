// MC-010 — AuthModule. Wires AuthController + AuthService. No global
// filters here — those live in app.module.ts so they apply to every
// module, not just auth.

import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}

export { AuthService } from './auth.service.js';
export { AuthController } from './auth.controller.js';
