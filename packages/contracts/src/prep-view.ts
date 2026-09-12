// MC-060/MC-061 — Zod contracts for prep sessions and the storage plan.

import { z } from 'zod';

export const PrepIntensitySchema = z.enum(['MINIMAL_15', 'COMPONENTS_1H', 'BATCH_3H', 'FULL_WEEK']);
export type PrepIntensity = z.infer<typeof PrepIntensitySchema>;

export const PrepTaskDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  durationMinutes: z.number().int(),
  sequence: z.number().int(),
  parallelGroup: z.number().int().nullable(),
  instructions: z.string(),
  done: z.boolean(),
});
export type PrepTaskDto = z.infer<typeof PrepTaskDtoSchema>;

export const PrepSessionDtoSchema = z.object({
  id: z.string(),
  mealPlanId: z.string(),
  intensity: PrepIntensitySchema,
  targetMinutes: z.number().int(),
  tasks: z.array(PrepTaskDtoSchema),
});
export type PrepSessionDto = z.infer<typeof PrepSessionDtoSchema>;

export const StorageAssignmentDtoSchema = z.object({
  entryId: z.string(),
  title: z.string(),
  dayIndex: z.number().int(),
  containerNumber: z.number().int().nullable(),
  storageMethod: z.enum(['FREEZER', 'FRIDGE', 'NONE']),
  defrostDate: z.string().nullable(),
  useDate: z.string(),
  addBeforeServing: z.boolean(),
});
export type StorageAssignmentDto = z.infer<typeof StorageAssignmentDtoSchema>;

export const StoragePlanDtoSchema = z.object({
  assignments: z.array(StorageAssignmentDtoSchema),
  addBeforeServing: z.array(StorageAssignmentDtoSchema),
  containerCount: z.number().int(),
});
export type StoragePlanDto = z.infer<typeof StoragePlanDtoSchema>;
