-- MC-022 fix-forward per ADR-0021: add soft-delete tombstone + user
-- notes to PantryItem. Two nullable columns in one migration, plus
-- a composite index on (householdId, archivedAt) for the common
-- "active items in my household" query path.

-- AlterTable
ALTER TABLE "PantryItem" ADD COLUMN "archivedAt" TIMESTAMPTZ(6);
ALTER TABLE "PantryItem" ADD COLUMN "notes" TEXT;

-- CreateIndex
CREATE INDEX "PantryItem_householdId_archivedAt_idx"
  ON "PantryItem" ("householdId", "archivedAt");
