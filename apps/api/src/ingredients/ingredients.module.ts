// MC-021 — Module wiring. No imports of AuthModule — the catalog
// endpoints are public. The IngredientsService relies on
// getPrisma() from @multichef/database, which lazy-initialises the
// PrismaClient from DATABASE_URL.

import { Module } from '@nestjs/common';
import { IngredientsController } from './ingredients.controller.js';
import { IngredientsService } from './ingredients.service.js';

@Module({
  controllers: [IngredientsController],
  providers: [IngredientsService],
  exports: [IngredientsService],
})
export class IngredientsModule {}
