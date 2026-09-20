// MC-050 — Zod contracts for the Job API (GET /api/v1/jobs/:id).
//
// Job rows in Postgres mirror BullMQ job state (ADR-0004). Stages are
// free-form strings on the wire; the canonical pipeline lives in the
// worker (queued → filtering → scoring → optimizing → building-list →
// done).

import { z } from 'zod';

export const JobStatusSchema = z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobTypeSchema = z.enum([
  'GENERATE_TODAY',
  'REPLACE_MEAL',
  'GENERATE_PLAN',
  'RESCUE',
  'LEFTOVERS',
  'ROULETTE',
  'REGENERATE',
  'BUILD_SHOPPING_LIST',
]);
export type JobType = z.infer<typeof JobTypeSchema>;

export const JobDtoSchema = z.object({
  id: z.string().min(1),
  type: JobTypeSchema,
  status: JobStatusSchema,
  progress: z.number().int().min(0).max(100),
  stage: z.string().nullable(),
  resultRef: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type JobDto = z.infer<typeof JobDtoSchema>;
