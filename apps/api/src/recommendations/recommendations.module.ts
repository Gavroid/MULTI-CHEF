// MC-033/MC-042 — Recommendations module wiring.

import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { AuthModule } from '../auth/auth.module.js';
import { RecipesModule } from '../recipes/recipes.module.js';
import { RecommendationsController } from './recommendations.controller.js';
import { RecommendationsService } from './recommendations.service.js';
import { TemplateAiProvider } from './ai/template-provider.js';
import { LlmAiProvider } from './ai/llm-provider.js';
import {
  InMemoryRouletteCounter,
  RedisRouletteCounter,
  type RouletteCounter,
} from './roulette-counter.js';

/**
 * MC-042: Redis-backed reject counter when REDIS_URL is set; the
 * in-memory fallback keeps dev/test working without Redis (prod has
 * Redis per PRD §6 — single-instance limitation noted in the module).
 */
export function createRouletteCounter(): RouletteCounter {
  const url = process.env['REDIS_URL'];
  if (url) {
    return new RedisRouletteCounter(new Redis(url) as never);
  }
  return new InMemoryRouletteCounter();
}

@Module({
  imports: [AuthModule, RecipesModule],
  controllers: [RecommendationsController],
  providers: [
    RecommendationsService,
    TemplateAiProvider,
    // T69-A/B (E26): the DI seam is live — with AI_LLM_ENABLED=true plus
    // a vendor key, explanations route through the resilient LLM client
    // (template stays as the synchronous + failure fallback).
    {
      provide: 'AiExplanationProvider',
      useFactory: (template: TemplateAiProvider) => {
        const llmEnabled =
          process.env['AI_LLM_ENABLED'] === 'true' &&
          Boolean(process.env['OPENAI_API_KEY'] ?? process.env['ANTHROPIC_API_KEY']);
        return llmEnabled ? new LlmAiProvider(process.env, template) : template;
      },
      inject: [TemplateAiProvider],
    },
    { provide: 'RouletteCounter', useFactory: createRouletteCounter },
  ],
})
export class RecommendationsModule {}
