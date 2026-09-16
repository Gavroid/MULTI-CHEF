-- T17-A drift follow-up (2/2): several @@index declarations existed
-- only in schema.prisma and were created by hand on the original host —
-- a migrations-fresh database (CI) lacked them, failing
-- check-schema-drift. Idempotent: IF NOT EXISTS keeps prod no-op.
CREATE INDEX IF NOT EXISTS "HouseholdMember_userId_role_idx" ON "HouseholdMember"("userId", "role");
CREATE INDEX IF NOT EXISTS "Job_status_createdAt_idx" ON "Job"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "MealPlan_householdId_status_idx" ON "MealPlan"("householdId", "status");
CREATE INDEX IF NOT EXISTS "PrepTask_prepSessionId_sequence_idx" ON "PrepTask"("prepSessionId", "sequence");
CREATE INDEX IF NOT EXISTS "Recipe_createdAt_id_idx" ON "Recipe"("createdAt", "id");
CREATE INDEX IF NOT EXISTS "RecipeIngredient_ingredientId_substitutesFor_idx" ON "RecipeIngredient"("ingredientId", "substitutesFor");
CREATE INDEX IF NOT EXISTS "ShoppingList_householdId_status_idx" ON "ShoppingList"("householdId", "status");
