// MC-033 — TemplateAiProvider: deterministic explanations from the
// MC-032 package. No LLM (ADR: LLM enrichment is a later phase with a
// feature flag). Registered in RecommendationsModule as
// 'AiExplanationProvider' so later phases can swap the implementation.

import { Injectable } from '@nestjs/common';
import { buildExplanation } from '@multichef/recommendation';
import type { ScoredRecipe } from '@multichef/recommendation';

export interface AiExplanationProvider {
  explain(
    scored: ScoredRecipe,
    extra?: { toBuyCount?: number; chainTag?: string | null; noChains?: boolean },
  ): string;
}

@Injectable()
export class TemplateAiProvider implements AiExplanationProvider {
  explain(
    scored: ScoredRecipe,
    extra?: { toBuyCount?: number; chainTag?: string | null; noChains?: boolean },
  ): string {
    const base = buildExplanation(scored);
    if (extra?.noChains) {
      return `${base} · нет подходящих цепочек`;
    }
    if (extra?.chainTag) {
      return `${base} · цепочка «${extra.chainTag}»`;
    }
    if (typeof extra?.toBuyCount === 'number') {
      return extra.toBuyCount === 0
        ? `${base} · всё есть дома`
        : `${base} · докупить ${extra.toBuyCount} продукт(а)`;
    }
    return base;
  }
}
