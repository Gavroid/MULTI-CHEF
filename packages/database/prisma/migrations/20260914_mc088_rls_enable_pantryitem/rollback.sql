-- Rollback mc088 (ADR-0023 phase 3): деактивировать RLS на PantryItem.
ALTER TABLE "PantryItem" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "PantryItem" DISABLE ROW LEVEL SECURITY;
