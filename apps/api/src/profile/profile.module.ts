// MC-011 — ProfileModule. Wires ProfileController + ProfileService +
// the shared AuthGuard. Imports AuthModule because AuthGuard depends
// on AuthService (validated through DI at app boot).

import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller.js';
import { ProfileService } from './profile.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthGuard } from '../common/auth-guard.js';

@Module({
  imports: [AuthModule],
  controllers: [ProfileController],
  providers: [ProfileService, AuthGuard],
  exports: [ProfileService],
})
export class ProfileModule {}
