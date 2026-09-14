-- ADR-0023 фаза 1 (T4, audit round 3 / VERIFICATION.md §T4): RLS
-- tenant-isolation policies, created INERT. This migration only
-- declares the policies — it intentionally does NOT run
-- `ENABLE/FORCE ROW LEVEL SECURITY`, because the API data layer does
-- not set the app.household_id / app.user_id session variables yet
-- (that is the Phase 2 refactor; enabling now would fail-closed every
-- tenant query and take the API down). Activation is a separate,
-- operator-approved migration (Phase 3) per ADR-0023.
--
-- All policies are fail-closed: current_setting(..., true) returns
-- NULL when the context is absent, and NULL comparison filters the
-- row. Catalog tables (Ingredient*, Recipe*, StorageRule) are public
-- read-only and stay policy-free by design.

-- User-scoped tables (app.user_id) ------------------------------------

CREATE POLICY tenant_isolation ON "User"
  USING ("id" = current_setting('app.user_id', true))
  WITH CHECK ("id" = current_setting('app.user_id', true));

CREATE POLICY tenant_isolation ON "Session"
  USING ("userId" = current_setting('app.user_id', true))
  WITH CHECK ("userId" = current_setting('app.user_id', true));

CREATE POLICY tenant_isolation ON "Job"
  USING ("userId" = current_setting('app.user_id', true))
  WITH CHECK ("userId" = current_setting('app.user_id', true));

CREATE POLICY tenant_isolation ON "Preference"
  USING ("userId" = current_setting('app.user_id', true))
  WITH CHECK ("userId" = current_setting('app.user_id', true));

CREATE POLICY tenant_isolation ON "NutritionProfile"
  USING ("userId" = current_setting('app.user_id', true))
  WITH CHECK ("userId" = current_setting('app.user_id', true));

-- Household-scoped tables (app.household_id) --------------------------

CREATE POLICY tenant_isolation ON "Household"
  USING (
    "id" = current_setting('app.household_id', true)
    OR "ownerId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    "id" = current_setting('app.household_id', true)
    OR "ownerId" = current_setting('app.user_id', true)
  );

CREATE POLICY tenant_isolation ON "HouseholdMember"
  USING (
    "userId" = current_setting('app.user_id', true)
    OR "householdId" = current_setting('app.household_id', true)
  )
  WITH CHECK (
    "userId" = current_setting('app.user_id', true)
    OR "householdId" = current_setting('app.household_id', true)
  );

CREATE POLICY tenant_isolation ON "PantryItem"
  USING ("householdId" = current_setting('app.household_id', true))
  WITH CHECK ("householdId" = current_setting('app.household_id', true));

CREATE POLICY tenant_isolation ON "MealPlan"
  USING ("householdId" = current_setting('app.household_id', true))
  WITH CHECK ("householdId" = current_setting('app.household_id', true));

CREATE POLICY tenant_isolation ON "MealPlanDay"
  USING (
    EXISTS (
      SELECT 1 FROM "MealPlan" m
      WHERE m.id = "mealPlanId"
        AND m."householdId" = current_setting('app.household_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "MealPlan" m
      WHERE m.id = "mealPlanId"
        AND m."householdId" = current_setting('app.household_id', true)
    )
  );

CREATE POLICY tenant_isolation ON "MealPlanEntry"
  USING (
    EXISTS (
      SELECT 1
      FROM "MealPlanDay" d
      JOIN "MealPlan" m ON m.id = d."mealPlanId"
      WHERE d.id = "dayId"
        AND m."householdId" = current_setting('app.household_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "MealPlanDay" d
      JOIN "MealPlan" m ON m.id = d."mealPlanId"
      WHERE d.id = "dayId"
        AND m."householdId" = current_setting('app.household_id', true)
    )
  );

CREATE POLICY tenant_isolation ON "PrepSession"
  USING ("mealPlanId" IN (SELECT id FROM "MealPlan" WHERE "householdId" = current_setting('app.household_id', true)))
  WITH CHECK ("mealPlanId" IN (SELECT id FROM "MealPlan" WHERE "householdId" = current_setting('app.household_id', true)));

CREATE POLICY tenant_isolation ON "PrepTask"
  USING (
    EXISTS (
      SELECT 1
      FROM "PrepSession" s
      JOIN "MealPlan" m ON m.id = s."mealPlanId"
      WHERE s.id = "prepSessionId"
        AND m."householdId" = current_setting('app.household_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "PrepSession" s
      JOIN "MealPlan" m ON m.id = s."mealPlanId"
      WHERE s.id = "prepSessionId"
        AND m."householdId" = current_setting('app.household_id', true)
    )
  );

CREATE POLICY tenant_isolation ON "PreparedPortion"
  USING (
    EXISTS (
      SELECT 1
      FROM "MealPlanEntry" e
      JOIN "MealPlanDay" d ON d.id = e."dayId"
      JOIN "MealPlan" m ON m.id = d."mealPlanId"
      WHERE e.id = "mealPlanEntryId"
        AND m."householdId" = current_setting('app.household_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "MealPlanEntry" e
      JOIN "MealPlanDay" d ON d.id = e."dayId"
      JOIN "MealPlan" m ON m.id = d."mealPlanId"
      WHERE e.id = "mealPlanEntryId"
        AND m."householdId" = current_setting('app.household_id', true)
    )
  );

CREATE POLICY tenant_isolation ON "ShoppingList"
  USING ("householdId" = current_setting('app.household_id', true))
  WITH CHECK ("householdId" = current_setting('app.household_id', true));

CREATE POLICY tenant_isolation ON "ShoppingListItem"
  USING (
    EXISTS (
      SELECT 1 FROM "ShoppingList" sl
      WHERE sl.id = "shoppingListId"
        AND sl."householdId" = current_setting('app.household_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "ShoppingList" sl
      WHERE sl.id = "shoppingListId"
        AND sl."householdId" = current_setting('app.household_id', true)
    )
  );
