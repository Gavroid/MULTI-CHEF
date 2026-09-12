// MC-042 — Zod contracts for the culinary roulette endpoints.
//
// POST /api/v1/recommendations/roulette/draw   → one weighted-random card
// POST /api/v1/recommendations/roulette/reject → burns one of 2 rejects
//
// The server owns the reject counter (PRD §2.3.5: max 2 «Другое»,
// then «Судьба выбрана»); attemptsLeft is informational for the UI.

import { z } from 'zod';
import { BudgetModeSchema, TodayOptionDtoSchema } from './recommendations.js';

export const MAX_ROULETTE_REJECTS = 2;

export const RouletteDrawRequestDtoSchema = z.object({
  budgetMode: BudgetModeSchema.optional(),
  maxMinutes: z.number().int().min(5).max(360).optional(),
});
export type RouletteDrawRequestDto = z.infer<typeof RouletteDrawRequestDtoSchema>;

export const RouletteDrawResponseDtoSchema = z.object({
  option: TodayOptionDtoSchema,
  /** Rejects still available AFTER this draw (2 on a fresh session). */
  attemptsLeft: z.number().int().min(0).max(MAX_ROULETTE_REJECTS),
});
export type RouletteDrawResponseDto = z.infer<typeof RouletteDrawResponseDtoSchema>;

export const RouletteRejectResponseDtoSchema = z.object({
  attemptsLeft: z.number().int().min(0).max(MAX_ROULETTE_REJECTS),
});
export type RouletteRejectResponseDto = z.infer<typeof RouletteRejectResponseDtoSchema>;
