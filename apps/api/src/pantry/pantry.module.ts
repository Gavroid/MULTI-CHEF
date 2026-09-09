// MC-022 — PantryModule. Wires the authenticated PantryController
// + PantryService. Imports AuthModule because AuthGuard needs
// AuthService (validated via DI at app boot).

import { Module } from '@nestjs/common';
import { PantryController } from './pantry.controller.js';
import { PantryService } from './pantry.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthGuard } from '../common/auth-guard.js';

@Module({
  imports: [AuthModule],
  controllers: [PantryController],
  providers: [PantryService, AuthGuard],
  exports: [PantryService],
})
export class PantryModule {}
