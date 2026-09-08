-- MULTI-CHEF — initial migration (MC-003).
--
-- Generated from prisma/schema.prisma via `prisma migrate diff
-- --from-empty --to-schema-datamodel prisma/schema.prisma --script`,
-- with the following MC-003-only additions appended at the bottom:
--
--   1. CREATE EXTENSION pg_trgm / unaccent / vector (PRD §3 / §3.3)
--   2. Partial unique index `one_active_plan` on MealPlan
--      (PRD §3.3 — only one ACTIVE plan per household)
--   3. GIN trigram indexes for fuzzy search
--      (PRD §3.3: alias_trgm + the PRD §3.2 canonicalName lookup)
--   4. GIN index on Recipe.tags (PRD §3.2 — array of tags)
--
-- DO NOT hand-edit this file. Regenerate via `prisma migrate dev`
-- once the schema is stable; the custom block at the bottom is
-- preserved by hand only when the migration is created from scratch.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "SkillLevel" AS ENUM ('BEGINNER', 'CONFIDENT', 'EXPERIMENTER');

-- CreateEnum
CREATE TYPE "DietType" AS ENUM ('NONE', 'VEGETARIAN', 'VEGAN', 'PESCATARIAN');

-- CreateEnum
CREATE TYPE "PreferenceKind" AS ENUM ('LOVE', 'DISLIKE', 'ALLERGY', 'EXCLUDE');

-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('G', 'ML', 'PIECE');

-- CreateEnum
CREATE TYPE "IngredientStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AmountStatus" AS ENUM ('PLENTY', 'SOME', 'LOW');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('NORMAL', 'USE_FIRST', 'STAPLE');

-- CreateEnum
CREATE TYPE "StorageLocation" AS ENUM ('PANTRY', 'FRIDGE', 'FREEZER');

-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK');

-- CreateEnum
CREATE TYPE "RecipeStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RecipeSourceType" AS ENUM ('CURATED', 'IMPORTED', 'USER');

-- CreateEnum
CREATE TYPE "MealPlanStatus" AS ENUM ('DRAFT', 'GENERATING', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MealPlanEntrySource" AS ENUM ('GENERATED', 'USER_PICK', 'REPLACED', 'ROULETTE');

-- CreateEnum
CREATE TYPE "StorageMethod" AS ENUM ('FRIDGE', 'FREEZER');

-- CreateEnum
CREATE TYPE "StorageRuleMethod" AS ENUM ('FREEZE_OK', 'FRIDGE_ONLY', 'PARTIAL_PREP', 'NO_PREP', 'ADD_BEFORE_SERVING');

-- CreateEnum
CREATE TYPE "ShoppingListStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PrepIntensity" AS ENUM ('MINIMAL_15', 'COMPONENTS_1H', 'BATCH_3H', 'FULL_WEEK');

-- CreateEnum
CREATE TYPE "PrepStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('GENERATE_TODAY', 'GENERATE_PLAN', 'RESCUE', 'LEFTOVERS', 'ROULETTE', 'REGENERATE', 'BUILD_SHOPPING_LIST');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "tz" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "isGuestConverted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Моя семья',
    "ownerId" TEXT NOT NULL,
    "defaultPeopleCount" INTEGER NOT NULL DEFAULT 2,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'RUB',
    "budgetWeekKopecks" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdMember" (
    "householdId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "joinedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdMember_pkey" PRIMARY KEY ("householdId","userId")
);

-- CreateTable
CREATE TABLE "NutritionProfile" (
    "userId" TEXT NOT NULL,
    "targetCalories" INTEGER,
    "targetProteinG" INTEGER,
    "targetFatG" INTEGER,
    "targetCarbsG" INTEGER,
    "mealsPerDay" INTEGER NOT NULL DEFAULT 3,
    "preferredPrepMinutes" INTEGER NOT NULL DEFAULT 30,
    "skillLevel" "SkillLevel" NOT NULL DEFAULT 'CONFIDENT',
    "appliances" TEXT[] DEFAULT ARRAY['STOVE','OVEN','MICROWAVE']::TEXT[],
    "dietType" "DietType" NOT NULL DEFAULT 'NONE',
    "activityNotes" TEXT,

    CONSTRAINT "NutritionProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Preference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ingredientId" TEXT,
    "kind" "PreferenceKind" NOT NULL,
    "note" TEXT,

    CONSTRAINT "Preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "IngredientCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "defaultUnit" "Unit" NOT NULL,
    "density" DOUBLE PRECISION,
    "ediblePartRatio" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "packageSize" DOUBLE PRECISION,
    "packageUnit" "Unit",
    "avgPriceKopecks" INTEGER,
    "defaultShelfDaysFridge" INTEGER,
    "defaultShelfDaysPantry" INTEGER,
    "defaultShelfDaysFreezer" INTEGER,
    "status" "IngredientStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientAlias" (
    "ingredientId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ru',

    CONSTRAINT "IngredientAlias_pkey" PRIMARY KEY ("alias","locale")
);

-- CreateTable
CREATE TABLE "IngredientNutrition" (
    "ingredientId" TEXT NOT NULL,
    "caloriesPer100g" DECIMAL(7,2) NOT NULL,
    "proteinPer100g" DECIMAL(7,2) NOT NULL,
    "fatPer100g" DECIMAL(7,2) NOT NULL,
    "carbsPer100g" DECIMAL(7,2) NOT NULL,
    "fiberPer100g" DECIMAL(7,2) NOT NULL,
    "source" TEXT NOT NULL,
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "IngredientNutrition_pkey" PRIMARY KEY ("ingredientId")
);

-- CreateTable
CREATE TABLE "PantryItem" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit" "Unit" NOT NULL,
    "estimatedGrams" DECIMAL(10,2) NOT NULL,
    "amountStatus" "AmountStatus" NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "storageLocation" "StorageLocation" NOT NULL,
    "opened" BOOLEAN NOT NULL DEFAULT false,
    "purchaseDate" DATE,
    "expiresAt" DATE,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PantryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "servings" INTEGER NOT NULL,
    "prepMinutes" INTEGER NOT NULL,
    "cookMinutes" INTEGER NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "imageKey" TEXT,
    "instructions" JSONB NOT NULL,
    "mealTypes" "MealType"[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredAppliances" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "leftoverSourceOf" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "chainTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceType" "RecipeSourceType" NOT NULL DEFAULT 'CURATED',
    "status" "RecipeStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeIngredient" (
    "recipeId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit" "Unit" NOT NULL,
    "grams" DECIMAL(10,2) NOT NULL,
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "substitutesFor" TEXT,
    "preparationNote" TEXT,

    CONSTRAINT "RecipeIngredient_pkey" PRIMARY KEY ("recipeId","ingredientId")
);

-- CreateTable
CREATE TABLE "RecipeNutrition" (
    "recipeId" TEXT NOT NULL,
    "servingCalories" DECIMAL(8,2) NOT NULL,
    "servingProteinG" DECIMAL(8,2) NOT NULL,
    "servingFatG" DECIMAL(8,2) NOT NULL,
    "servingCarbsG" DECIMAL(8,2) NOT NULL,
    "servingGrams" DECIMAL(8,2) NOT NULL,
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "RecipeNutrition_pkey" PRIMARY KEY ("recipeId")
);

-- CreateTable
CREATE TABLE "StorageRule" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT,
    "recipeTag" TEXT,
    "storageMethod" "StorageRuleMethod" NOT NULL,
    "maxHoursFridge" INTEGER,
    "maxDaysFreezer" INTEGER,
    "freezingAllowed" BOOLEAN NOT NULL,
    "partialPrepAllowed" BOOLEAN NOT NULL,
    "addBeforeServing" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,

    CONSTRAINT "StorageRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealPlan" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "peopleCount" INTEGER NOT NULL,
    "targetBudgetKopecks" INTEGER,
    "targetCalories" INTEGER,
    "targetProteinG" INTEGER,
    "targetFatG" INTEGER,
    "targetCarbsG" INTEGER,
    "status" "MealPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "generationSettings" JSONB NOT NULL,
    "nutritionAccuracy" TEXT NOT NULL DEFAULT 'ESTIMATED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "MealPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealPlanDay" (
    "id" TEXT NOT NULL,
    "mealPlanId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalCalories" DECIMAL(8,2) NOT NULL,
    "totalProteinG" DECIMAL(8,2) NOT NULL,
    "totalFatG" DECIMAL(8,2) NOT NULL,
    "totalCarbsG" DECIMAL(8,2) NOT NULL,

    CONSTRAINT "MealPlanDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealPlanEntry" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "mealType" "MealType" NOT NULL,
    "recipeId" TEXT NOT NULL,
    "servings" DECIMAL(4,1) NOT NULL,
    "portionGrams" DECIMAL(8,2) NOT NULL,
    "position" INTEGER NOT NULL,
    "source" "MealPlanEntrySource" NOT NULL,

    CONSTRAINT "MealPlanEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShoppingList" (
    "id" TEXT NOT NULL,
    "mealPlanId" TEXT,
    "householdId" TEXT NOT NULL,
    "estimatedTotalKopecks" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'RUB',
    "budgetLimitKopecks" INTEGER,
    "status" "ShoppingListStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ShoppingList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShoppingListItem" (
    "id" TEXT NOT NULL,
    "shoppingListId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "requiredGrams" DECIMAL(10,2) NOT NULL,
    "packageQuantity" INTEGER NOT NULL,
    "packageSize" DECIMAL(10,2) NOT NULL,
    "packageUnit" "Unit" NOT NULL,
    "estimatedPriceKopecks" INTEGER,
    "utilityScore" INTEGER,
    "purchased" BOOLEAN NOT NULL DEFAULT false,
    "purchasedAt" TIMESTAMPTZ(6),
    "categoryId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "ShoppingListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepSession" (
    "id" TEXT NOT NULL,
    "mealPlanId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMPTZ(6) NOT NULL,
    "targetMinutes" INTEGER NOT NULL,
    "intensity" "PrepIntensity" NOT NULL,
    "status" "PrepStatus" NOT NULL DEFAULT 'PLANNED',

    CONSTRAINT "PrepSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepTask" (
    "id" TEXT NOT NULL,
    "prepSessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "parallelGroup" INTEGER,
    "instructions" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PrepTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreparedPortion" (
    "id" TEXT NOT NULL,
    "mealPlanEntryId" TEXT NOT NULL,
    "containerNumber" INTEGER NOT NULL,
    "preparedAt" TIMESTAMPTZ(6) NOT NULL,
    "useBefore" TIMESTAMPTZ(6) NOT NULL,
    "storageMethod" "StorageMethod" NOT NULL,
    "defrostAt" TIMESTAMPTZ(6),
    "servingInstructions" TEXT,

    CONSTRAINT "PreparedPortion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT,
    "resultRef" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_canonicalName_key" ON "Ingredient"("canonicalName");

-- CreateIndex
CREATE INDEX "IngredientAlias_ingredientId_idx" ON "IngredientAlias"("ingredientId");

-- CreateIndex
CREATE INDEX "Preference_userId_kind_idx" ON "Preference"("userId", "kind");

-- CreateIndex
CREATE INDEX "PantryItem_householdId_idx" ON "PantryItem"("householdId");

-- CreateIndex
CREATE INDEX "PantryItem_householdId_expiresAt_idx" ON "PantryItem"("householdId", "expiresAt");

-- CreateIndex
CREATE INDEX "PantryItem_ingredientId_idx" ON "PantryItem"("ingredientId");

-- CreateIndex
CREATE INDEX "RecipeIngredient_ingredientId_idx" ON "RecipeIngredient"("ingredientId");

-- CreateIndex
CREATE INDEX "MealPlan_householdId_startDate_idx" ON "MealPlan"("householdId", "startDate");

-- CreateIndex
CREATE INDEX "MealPlanEntry_dayId_mealType_idx" ON "MealPlanEntry"("dayId", "mealType");

-- CreateIndex
CREATE UNIQUE INDEX "MealPlanDay_mealPlanId_date_key" ON "MealPlanDay"("mealPlanId", "date");

-- CreateIndex
CREATE INDEX "ShoppingListItem_shoppingListId_purchased_idx" ON "ShoppingListItem"("shoppingListId", "purchased");

-- CreateIndex
CREATE INDEX "Job_userId_createdAt_idx" ON "Job"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Household" ADD CONSTRAINT "Household_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NutritionProfile" ADD CONSTRAINT "NutritionProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preference" ADD CONSTRAINT "Preference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preference" ADD CONSTRAINT "Preference_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "IngredientCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientAlias" ADD CONSTRAINT "IngredientAlias_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientNutrition" ADD CONSTRAINT "IngredientNutrition_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PantryItem" ADD CONSTRAINT "PantryItem_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PantryItem" ADD CONSTRAINT "PantryItem_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_substitutesFor_fkey" FOREIGN KEY ("substitutesFor") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeNutrition" ADD CONSTRAINT "RecipeNutrition_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageRule" ADD CONSTRAINT "StorageRule_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlan" ADD CONSTRAINT "MealPlan_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlanDay" ADD CONSTRAINT "MealPlanDay_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlanEntry" ADD CONSTRAINT "MealPlanEntry_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "MealPlanDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlanEntry" ADD CONSTRAINT "MealPlanEntry_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingList" ADD CONSTRAINT "ShoppingList_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingList" ADD CONSTRAINT "ShoppingList_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingListItem" ADD CONSTRAINT "ShoppingListItem_shoppingListId_fkey" FOREIGN KEY ("shoppingListId") REFERENCES "ShoppingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingListItem" ADD CONSTRAINT "ShoppingListItem_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingListItem" ADD CONSTRAINT "ShoppingListItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "IngredientCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepSession" ADD CONSTRAINT "PrepSession_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepTask" ADD CONSTRAINT "PrepTask_prepSessionId_fkey" FOREIGN KEY ("prepSessionId") REFERENCES "PrepSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparedPortion" ADD CONSTRAINT "PreparedPortion_mealPlanEntryId_fkey" FOREIGN KEY ("mealPlanEntryId") REFERENCES "MealPlanEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- MC-003 custom block: PRD §3.3 indexes + CREATE EXTENSION.
-- Hand-maintained; do not regenerate from the schema.
-- ---------------------------------------------------------------------------

-- pg_trgm and unaccent are required for fuzzy alias search and case-
-- insensitive lookups. vector is installed per PRD §3 (pgvector is
-- reserved for later AI features, see ADR-0004 + PRD §4.9).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS vector;

-- PRD §3.3 — GIN trigram on Ingredient.canonicalName for fuzzy search.
-- Note: a unique btree index on canonicalName already exists for exact
-- match; the GIN index handles substring / typo-tolerant queries.
CREATE INDEX "idx_ingredient_canonical_trgm" ON "Ingredient" USING gin ("canonicalName" gin_trgm_ops);

-- PRD §3.3 — GIN trigram on IngredientAlias.alias. Combined with
-- unaccent(), the search pipeline can rank matches even when the
-- user typed a slightly off spelling.
CREATE INDEX "idx_alias_trgm" ON "IngredientAlias" USING gin ("alias" gin_trgm_ops);

-- PRD §3.2 — GIN index over the Recipe.tags text[] column. Used by
-- the scoring algorithm (PRD §3.5) to filter by tag membership.
CREATE INDEX "idx_recipe_tags" ON "Recipe" USING gin ("tags");

-- PRD §3.3 — partial unique index enforcing "exactly one ACTIVE plan
-- per household". A second MealPlan row with status='ACTIVE' on the
-- same household is rejected at the database layer.
CREATE UNIQUE INDEX "one_active_plan" ON "MealPlan"("householdId") WHERE "status" = 'ACTIVE';
