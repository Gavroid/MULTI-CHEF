// MC-033/MC-040 — Recommendations DTOs (re-export contracts + request schema).

import { z } from 'zod';
import {
  LeftoversRequestDtoSchema,
  LeftoversResponseDtoSchema,
  RescueRequestDtoSchema,
  RouletteDrawRequestDtoSchema,
  TodayRequestDtoSchema,
  TodayRecommendationDtoSchema,
} from '@multichef/contracts';

export {
  LeftoversRequestDtoSchema,
  LeftoversResponseDtoSchema,
  RescueRequestDtoSchema,
  RouletteDrawRequestDtoSchema,
  TodayRequestDtoSchema,
  TodayRecommendationDtoSchema,
};
export type {
  LeftoversRequestDto,
  LeftoversResponseDto,
  RescueRequestDto,
  RescueResponseDto,
  RouletteDrawRequestDto,
  RouletteDrawResponseDto,
  RouletteRejectResponseDto,
  TodayRequestDto,
  TodayRecommendationDto,
} from '@multichef/contracts';

export const TodayParamsSchema = z.object({}).strip();
export type TodayParams = z.infer<typeof TodayParamsSchema>;
