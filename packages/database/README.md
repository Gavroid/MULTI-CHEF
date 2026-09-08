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

## ENV

The package reads `DATABASE_URL` exclusively through `@multichef/config`
(see `src/index.ts`). Do not add direct `process.env.DATABASE_URL`
reads; the env-coverage script in the repo root will fail if you do.
````
