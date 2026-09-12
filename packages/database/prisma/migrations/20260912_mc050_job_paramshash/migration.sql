-- MC-050: idempotency key for job enqueue dedup (5 min window).
-- AlterTable
ALTER TABLE "Job" ADD COLUMN "paramsHash" TEXT;

-- CreateIndex
CREATE INDEX "Job_paramsHash_idx" ON "Job"("paramsHash");
