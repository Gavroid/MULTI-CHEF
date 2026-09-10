// MC-033 — Recommendations module wiring.

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RecipesModule } from '../recipes/recipes.module.js';
import { RecommendationsController } from './recommendations.controller.js';
import { RecommendationsService } from './recommendations.service.js';
import { TemplateAiProvider } from './ai/template-provider.js';

@Module({
  imports: [AuthModule, RecipesModule],
  controllers: [RecommendationsController],
  providers: [
    RecommendationsService,
    // DI seam: later phases swap TemplateAiProvider for an LLM-backed one.
    { provide: 'AiExplanationProvider', useClass: TemplateAiProvider },
  ],
})
export class RecommendationsModule {}
