-- MC-085 — recipe title uniqueness + near-duplicate search support.
-- The seed runner upserts by title (no unique constraint existed); the
-- 2000-recipe catalog pipeline requires a hard uniqueness guarantee and
-- trigram search for near-duplicate detection.

CREATE UNIQUE INDEX "Recipe_title_lower_key" ON "Recipe" (lower("title"));

CREATE INDEX "Recipe_title_trgm_idx" ON "Recipe" USING gin ("title" gin_trgm_ops);
