-- T49/T61 (audit rounds 49/61): недостающие индексы создаются
-- CONCURRENTLY-скриптом (без блокировки записи) НА СУЩЕСТВУЮЩЕЙ БД,
-- затем регистрируются миграцией mc090 (для свежих БД). Имена
-- совпадают со сгенерированными Prisma из schema.prisma.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "MealPlan_householdId_status_idx" ON "MealPlan"("householdId", "status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PrepTask_prepSessionId_sequence_idx" ON "PrepTask"("prepSessionId", "sequence");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "HouseholdMember_userId_role_idx" ON "HouseholdMember"("userId", "role");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Job_status_created_at_idx" ON "Job"("status", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Recipe_created_at_id_idx" ON "Recipe"("createdAt", "id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ShoppingList_householdId_status_idx" ON "ShoppingList"("householdId", "status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "RecipeIngredient_ingredientId_substitutesFor_idx" ON "RecipeIngredient"("ingredientId", "substitutesFor");
