// T69-A/B (E26): LLM-backed explanation provider. Wraps the template
// provider — every LLM failure (breaker open, timeout, bad response)
// falls back to the deterministic template so the user NEVER sees a
// missing explanation. Enabled via AI_LLM_ENABLED=true + vendor key.
import { Injectable, Logger } from '@nestjs/common';
import type { ScoredRecipe } from '@multichef/recommendation';
import { ResilientHttp } from './resilient-http.js';
import type { AiExplanationProvider } from './template-provider.js';

export interface LlmProviderEnv {
  AI_LLM_ENABLED?: string | undefined;
  AI_LLM_VENDOR?: string;
  AI_LLM_BASE_URL?: string;
  AI_LLM_MODEL?: string;
  AI_LLM_TIMEOUT_MS?: string;
  AI_LLM_MAX_RETRIES?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  /** Test seam: injected into the HTTP client instead of global fetch. */
  fetchImpl?: typeof fetch;
}

const VENDORS = {
  openai: {
    defaultBase: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    key(env: LlmProviderEnv): string | undefined {
      return env.OPENAI_API_KEY;
    },
    endpoint(base: string): string {
      return `${base}/chat/completions`;
    },
    headers(key: string): Record<string, string> {
      return { Authorization: `Bearer ${key}` };
    },
    requestBody(model: string, prompt: string): unknown {
      return {
        model,
        max_tokens: 120,
        messages: [
          {
            role: 'system',
            content:
              'Ты помогаешь домашнему повару коротко объяснить подбор рецепта. Максимум одно предложение, по-русски.',
          },
          { role: 'user', content: prompt },
        ],
      };
    },
    extract(json: unknown): string | null {
      const choices = (json as { choices?: Array<{ message?: { content?: string } }> })?.choices;
      return choices?.[0]?.message?.content?.trim() ?? null;
    },
  },
  anthropic: {
    defaultBase: 'https://api.anthropic.com',
    defaultModel: 'claude-3-5-haiku-latest',
    key(env: LlmProviderEnv): string | undefined {
      return env.ANTHROPIC_API_KEY;
    },
    endpoint(base: string): string {
      return `${base}/v1/messages`;
    },
    headers(key: string): Record<string, string> {
      return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
    },
    requestBody(model: string, prompt: string): unknown {
      return {
        model,
        max_tokens: 120,
        messages: [{ role: 'user', content: prompt }],
        system:
          'Ты помогаешь домашнему повару коротко объяснить подбор рецепта. Максимум одно предложение, по-русски.',
      };
    },
    extract(json: unknown): string | null {
      const content = (json as { content?: Array<{ text?: string }> })?.content;
      return content?.[0]?.text?.trim() ?? null;
    },
  },
} as const;

export function buildLlmExplanationPrompt(
  scored: ScoredRecipe,
  extra?: { toBuyCount?: number; chainTag?: string | null },
): string {
  const parts = [
    `Рецепт: ${scored.recipe.title}.`,
    `Соответствие холодильнику: ${Math.round((scored.breakdown.pantryMatch?.value ?? 0) * 100)}%.`,
  ];
  if (typeof extra?.toBuyCount === 'number') {
    parts.push(`Докупить: ${extra.toBuyCount}.`);
  }
  if (extra?.chainTag) parts.push(`Цепочка: ${extra.chainTag}.`);
  parts.push('Объясни одной фразой, почему этот рецепт подходит.');
  return parts.join(' ');
}

@Injectable()
export class LlmAiProvider implements AiExplanationProvider {
  private readonly logger = new Logger('LlmAiProvider');
  private readonly http: ResilientHttp;
  private readonly vendor;
  private readonly model: string;

  constructor(
    private readonly env: LlmProviderEnv,
    private readonly fallback: AiExplanationProvider,
  ) {
    const vendorKey = (env.AI_LLM_VENDOR ?? 'openai') as keyof typeof VENDORS;
    this.vendor = VENDORS[vendorKey] ?? VENDORS.openai;
    this.model = env.AI_LLM_MODEL ?? this.vendor.defaultModel;
    this.http = new ResilientHttp({
      timeoutMs: Number(env.AI_LLM_TIMEOUT_MS ?? 3000),
      maxRetries: Number(env.AI_LLM_MAX_RETRIES ?? 2),
      breakerThreshold: 3,
      breakerCooldownMs: 30_000,
      ...(env.fetchImpl ? { fetchImpl: env.fetchImpl } : {}),
    });
  }

  private apiKey(): string | undefined {
    return this.vendor.key(this.env);
  }

  explain(
    scored: ScoredRecipe,
    extra?: { toBuyCount?: number; chainTag?: string | null; noChains?: boolean },
  ): string {
    // Sync interface: the LLM path is used only when an async result was
    // pre-warmed; sync callers get the template immediately. The async
    // variant (explainAsync) is the real entry point for new code.
    return this.fallback.explain(scored, extra);
  }

  async explainAsync(
    scored: ScoredRecipe,
    extra?: { toBuyCount?: number; chainTag?: string | null; noChains?: boolean },
  ): Promise<string> {
    const key = this.apiKey();
    if (!key) return this.fallback.explain(scored, extra);
    const prompt = buildLlmExplanationPrompt(scored, extra);
    try {
      const out = await this.http.postJson(
        this.vendor.endpoint(this.env.AI_LLM_BASE_URL ?? this.vendor.defaultBase),
        this.vendor.headers(key),
        this.vendor.requestBody(this.model, prompt),
      );
      const text = out.status === 200 ? this.vendor.extract(out.json) : null;
      return text ?? this.fallback.explain(scored, extra);
    } catch (err) {
      this.logger.warn(`llm explain failed (${(err as Error).name}); using template fallback`);
      return this.fallback.explain(scored, extra);
    }
  }
}
