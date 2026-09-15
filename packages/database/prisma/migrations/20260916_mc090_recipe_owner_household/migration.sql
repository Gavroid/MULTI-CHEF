-- T54-D (E24): owner semantics for recipe images.
-- null = global catalog asset (read-only for all households);
-- set = the owning household may replace imageKey via upload.
ALTER TABLE "Recipe" ADD COLUMN "ownerHouseholdId" TEXT;
CREATE INDEX "Recipe_ownerHouseholdId_idx" ON "Recipe"("ownerHouseholdId");
