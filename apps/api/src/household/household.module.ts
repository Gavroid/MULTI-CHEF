// MC-011 — HouseholdModule. Wires HouseholdController + HouseholdService.

import { Module } from '@nestjs/common';
import { HouseholdController } from './household.controller.js';
import { HouseholdService } from './household.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthGuard } from '../common/auth-guard.js';

@Module({
  imports: [AuthModule],
  controllers: [HouseholdController],
  providers: [HouseholdService, AuthGuard],
  exports: [HouseholdService],
})
export class HouseholdModule {}
