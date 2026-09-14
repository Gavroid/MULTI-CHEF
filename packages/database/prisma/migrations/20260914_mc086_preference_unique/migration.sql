-- T14-A (audit round 14): enforce the (userId, kind, ingredientId)
-- dedup at the DB level. addPreference() only deduped with a
-- check-then-act findFirst, so concurrent POSTs could insert duplicate
-- rows. Deduplicate first (keep the oldest row per tuple — ULIDs sort
-- by creation time), then add the unique constraint that Prisma
-- generates for @@unique([userId, kind, ingredientId]).
--
-- ingredientId is nullable and Postgres UNIQUE treats NULLs as
-- distinct, so note-only preferences (no ingredientId) remain
-- unconstrained by design (audit T14-E).

DELETE FROM "Preference" p
USING "Preference" q
WHERE p."userId" = q."userId"
  AND p."kind" = q."kind"
  AND p."ingredientId" IS NOT NULL
  AND p."ingredientId" = q."ingredientId"
  AND p."id" > q."id";

-- CreateIndex
CREATE UNIQUE INDEX "Preference_userId_kind_ingredientId_key"
  ON "Preference"("userId", "kind", "ingredientId");
