// MC-033 — Recommendations DTOs (re-export contracts + request schema).

import { z } from 'zod';
import { TodayRequestDtoSchema, TodayRecommendationDtoSchema } from '@multichef/contracts';

export { TodayRequestDtoSchema, TodayRecommendationDtoSchema };
export type { TodayRequestDto, TodayRecommendationDto } from '@multichef/contracts';

export const TodayParamsSchema = z.object({}).strip();
export type TodayParams = z.infer<typeof TodayParamsSchema>;
