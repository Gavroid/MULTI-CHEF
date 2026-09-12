// MC-055 — Zod contracts for the ACTIVE weekly plan (web «План» tab).
//
// The API serialises Prisma rows: dates → ISO strings, Decimals →
// strings; the schema coerces numeric fields with z.coerce.number().

import { z } from 'zod';
import { RecipeDtoSchema } from './recipes.js';

export const PlanMealTypeSchema = z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK']);
export type MealTypeView = z.infer<typeof PlanMealTypeSchema>;

export const PlanEntryDtoSchema = z.object({
  id: z.string(),
  mealType: PlanMealTypeSchema,
  recipe: RecipeDtoSchema,
  servings: z.coerce.number(),
  portionGrams: z.coerce.number(),
  position: z.number().int(),
});
export type PlanEntryDto = z.infer<typeof PlanEntryDtoSchema>;

export const PlanDayDtoSchema = z.object({
  id: z.string(),
  date: z.string(),
  totalCalories: z.coerce.number(),
  totalProteinG: z.coerce.number(),
  totalFatG: z.coerce.number(),
  totalCarbsG: z.coerce.number(),
  entries: z.array(PlanEntryDtoSchema),
});
export type PlanDayDto = z.infer<typeof PlanDayDtoSchema>;

export const ActivePlanDtoSchema = z.object({
  id: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  peopleCount: z.coerce.number(),
  status: z.string(),
  days: z.array(PlanDayDtoSchema),
});
export type ActivePlanDto = z.infer<typeof ActivePlanDtoSchema>;

/** Job stage → human label (progress screen). */
export const JOB_STAGE_LABELS: Record<string, string> = {
  queued: 'В очереди',
  filtering: 'Отбираем рецепты',
  scoring: 'Оцениваем варианты',
  optimizing: 'Собираем неделю',
  'building-list': 'Формируем список покупок',
  done: 'Готово',
};
