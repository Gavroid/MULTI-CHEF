-- ADR-0023 phase 3 (pilot activation, T4): enable and force Row-Level
-- Security on "PantryItem" — the table whose API surface was fully
-- migrated to withTenantContext() (pantry service, phase 2).
--
-- Every PantryItem query from the API now runs with the tenant context
-- installed (app.household_id / app.user_id are set per transaction);
-- the tenant_isolation policy filters rows by household. Fail-closed:
-- a query without context sees nothing.
--
-- Rollback: ALTER TABLE "PantryItem" NO FORCE ROW LEVEL SECURITY;
--           ALTER TABLE "PantryItem" DISABLE ROW LEVEL SECURITY;
-- (policies remain declared; data is untouched).

ALTER TABLE "PantryItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PantryItem" FORCE ROW LEVEL SECURITY;
