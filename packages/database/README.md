# @multichef/database

Prisma schema + generated client for MULTI-CHEF.

## Layout

````text
prisma/
  schema.prisma                          # 21 models, see PRD §3.2
  migrations/
    migration_lock.toml                  # provider pin
    20260101000000_mc003_initial/
      migration.sql                      # schema DDL + extensions + custom indexes
  seed/
    index.ts                             # no-op stub, real seed in MC-020/MC-031
src/
  index.ts                               # getPrisma(), closePrisma(), pingDatabase()
  __tests__/
    index.test.ts                        # MC-001 smoke (scaffold still loads)
    integration.test.ts                  # MC-003 Testcontainers (Docker required)
```text

## Requirements

- **Node 24 LTS** — see `.nvmrc` at the repo root.
- **pnpm >= 9** — see `packageManager` at the repo root.
- **Postgres 16** with extensions `pg_trgm`, `unaccent`, `vector`.
  The dev stack in `compose.yml` (repo root) provides them out of the box.
  - T17-B caveat: `vector` (pgvector) is **reserved for the future ML
    recommendation engine and is currently used by zero tables**. It
    requires a **superuser** role to create — the app user gets
    `permission denied`, so fresh environments must pre-install it
    before running `migrate deploy` (the initial migration
    `mc003_initial` executes `CREATE EXTENSION IF NOT EXISTS vector`).
- **Docker** — only for `pnpm test:integration`. The Testcontainers
  module spins up a real `postgres:16-alpine` container per run.

## Common commands

```bash
# Validate schema (no DB connection required)
pnpm --filter @multichef/database prisma validate

# Format schema
pnpm --filter @multichef/database prisma format

# Generate the Prisma client (writes to node_modules/@prisma/client)
pnpm --filter @multichef/database prisma generate

# Show the SQL diff between schema and an empty database
pnpm --filter @multichef/database prisma:diff

# Apply migrations to DATABASE_URL (CI / deploy / dev first-run)
pnpm --filter @multichef/database prisma migrate deploy

# Create a new migration after editing schema.prisma
pnpm --filter @multichef/database prisma migrate dev --name <short-name>

# Run seed (currently a no-op)
pnpm --filter @multichef/database prisma db seed

# Unit smoke (no Docker)
pnpm --filter @multichef/database test

# Integration tests (Docker required)
pnpm --filter @multichef/database test:integration
```text

## How to add a new field or model

1. Edit `prisma/schema.prisma`.
2. Run `pnpm --filter @multichef/database prisma migrate dev --name <change>`.
   This generates a new SQL file under `prisma/migrations/`. Review the
   generated SQL before committing — Prisma does the right thing for
   plain schema edits but **does not** add the custom GIN indexes
   listed at the bottom of `20260101000000_mc003_initial/migration.sql`.
3. If you need a new GIN / partial unique / functional index, append
   it by hand to the new migration file (mirroring the existing block).
4. Update `src/__tests__/integration.test.ts` to cover any new
   constraint, then run `pnpm --filter @multichef/database
test:integration` to confirm.

## Money and nutrients

Per PM-prompt #5 and PRD §3:

- Money is **integer kopecks** (`Int`). Never `Float`, `Real`, or
  `Double` for money fields.
- Nutrients are `Decimal(7,2)` or `Decimal(8,2)` depending on the
  field. Never `Float`.

The CI `prisma validate` step plus `grep -E 'Float|Real|Double'
schema.prisma` are the only acceptance checks for this rule — keep
them green.

## DB-only invariants (not representable in schema.prisma)

T17-A (audit round 17): the live database contains indexes that
Prisma **cannot model**. They are created in hand-written migrations
(`mc003_initial`, `mc085`) and enforced by Postgres, but
`schema.prisma` does not — and cannot — declare them. If you drop or
recreate the database by hand, re-check this list; `prisma migrate
deploy` recreates them only through the original migration files.

| Index                        | Table     | Definition                                                       | Business invariant                                             |
| ---------------------------- | --------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| `one_active_plan`            | `MealPlan`| `CREATE UNIQUE INDEX ... ON ("householdId") WHERE status='ACTIVE'`| Exactly ONE active meal plan per household (enforced at DB level)|
| `Recipe_title_lower_key`     | `Recipe`  | `CREATE UNIQUE INDEX ... USING btree (lower("title"))`            | Recipe titles are unique case-insensitively                     |
| `idx_ingredient_canonical_trgm` | `Ingredient` | GIN (`canonicalName gin_trgm_ops`)                          | Fuzzy search for ingredients                                    |
| `idx_alias_trgm`             | `IngredientAlias` | GIN (`alias gin_trgm_ops`)                                | Fuzzy alias resolution (search `?q=`)                           |
| `Recipe_title_trgm_idx`      | `Recipe`  | GIN (`title gin_trgm_ops`)                                       | Fuzzy recipe search                                             |

Why Prisma cannot express them:

- **Partial UNIQUE** (`one_active_plan`) — Prisma has no `WHERE` on
  `@@unique`; partial `WHERE` exists only for non-unique `@@index`
  (and cannot make it unique).
- **Functional indexes** (`lower("title")`) — no expression support
  in `@@unique` / `@@index`.
- **`gin_trgm_ops` operator classes** — `@@index(..., type: Gin)`
  exists, but only over plain columns, not with a trigram operator
  class.

Consequences for day-to-day work:

- Violating `one_active_plan` or `Recipe_title_lower_key` throws a
  raw `P2002` whose `meta.target` names the index, not a Prisma
  field — map it explicitly where a 409 is expected.
- `prisma migrate diff` / `db pull` silently ignore these indexes.
  The only source of truth for them is this table + the migrations.
- `Recipe.tags` GIN (`idx_recipe_tags`) IS now declared in
  `schema.prisma` (plain-column GIN is representable) — it is **not**
  part of the unrepresentable set.

## ENV

The package reads `DATABASE_URL` exclusively through `@multichef/config`
(see `src/index.ts`). Do not add direct `process.env.DATABASE_URL`
reads; the env-coverage script in the repo root will fail if you do.
````
