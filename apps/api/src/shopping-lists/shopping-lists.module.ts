// MC-054 — ShoppingLists module wiring.

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ShoppingListsController } from './shopping-lists.controller.js';
import { ShoppingListsService } from './shopping-lists.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ShoppingListsController],
  providers: [ShoppingListsService],
})
export class ShoppingListsModule {}
