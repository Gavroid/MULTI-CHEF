-- T17-A drift follow-up: schema.prisma index names use Prisma's
-- camelCase defaults; hand-written migrations created snake_case ones,
-- and the Job composite index existed only in the schema. This aligns
-- the live database with the schema (check-schema-drift green).
ALTER INDEX "Job_status_created_at_idx" RENAME TO "Job_status_createdAt_idx";
ALTER INDEX "Recipe_created_at_id_idx" RENAME TO "Recipe_createdAt_id_idx";
CREATE INDEX IF NOT EXISTS "Job_userId_type_paramsHash_createdAt_idx" ON "Job"("userId", "type", "paramsHash", "createdAt");
