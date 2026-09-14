-- ADR-0023 phase 3 (rollout wave 2): enable and force Row-Level
-- Security on the tenant tables whose API flows are fully migrated to
-- withTenantContext: meal-plans (MealPlan*, PrepSession, PrepTask),
-- shopping-lists (ShoppingList, ShoppingListItem), profile
-- (Preference, NutritionProfile) and the worker plan-week flow
-- (pantry/preference/nutrition reads + plan writes run in the job's
-- household context).
--
-- Fail-closed: a query without the tenant context sees nothing.
--
-- Rollback: per table —
--   ALTER TABLE <t> NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;
-- (policies remain declared; data is untouched).
--
-- NOT enabled here (auth-bootstrap redesign pending, user decision):
-- "User", "Session", "Household", "HouseholdMember", "Job" — their
-- flows create/read rows before any tenant context exists.

-- Meal plan aggregate ---------------------------------------------------

ALTER TABLE "MealPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MealPlan" FORCE ROW LEVEL SECURITY;

ALTER TABLE "MealPlanDay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MealPlanDay" FORCE ROW LEVEL SECURITY;

ALTER TABLE "MealPlanEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MealPlanEntry" FORCE ROW LEVEL SECURITY;

-- Prep flow ---------------------------------------------------------------

ALTER TABLE "PrepSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PrepSession" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PrepTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PrepTask" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PreparedPortion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PreparedPortion" FORCE ROW LEVEL SECURITY;

-- Shopping list aggregate -------------------------------------------------

ALTER TABLE "ShoppingList" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShoppingList" FORCE ROW LEVEL SECURITY;

ALTER TABLE "ShoppingListItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShoppingListItem" FORCE ROW LEVEL SECURITY;

-- Profile -----------------------------------------------------------------

ALTER TABLE "Preference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Preference" FORCE ROW LEVEL SECURITY;

ALTER TABLE "NutritionProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NutritionProfile" FORCE ROW LEVEL SECURITY;
