# MULTI-CHEF

MULTI-CHEF monorepo. This repository hosts the production code for the
project described in `docs/MULTICHEF-ARCHITECTURE-PRD.md`,
`docs/MULTICHEF-DEVELOPMENT-PLAN.md`, and `docs/MULTICHEF-TESTING-STRATEGY.md`.

> Full documentation — including setup, conventions, ADRs, and runbooks — is
> scheduled for `MC-004 (Documentation and regulations)` in Phase 0. Until
> then, this file lists only the commands needed to bootstrap the monorepo
> and run the smoke checks.

## Status

- Phase: **0 — scaffold (MC-001 done)**
- Next: `MC-002 — dev infrastructure and env`
- Deployment model: systemd bare-metal (see ADR-0006, added in MC-004)
- CI: minimal `hello CI` workflow only (full pipeline in MC-005)

## Repository layout

```
apps/
  web/         Next.js 15 web client (App Router, mobile-first)
  api/         NestJS + Fastify API (global prefix /api/v1)
  worker/      Background worker stub (real jobs in MC-050)
packages/
  contracts/   Cross-package TypeScript contracts (scaffold)
  database/    Prisma client wrapper (scaffold; real schema in MC-003)
  config/      Env loader + Zod validation (scaffold; real schema in MC-002)
  eslint-config/  Shared ESLint v9 flat-config
  typescript-config/  Base tsconfig presets
  ui/          UI design-system package (scaffold; tokens in MC-012)
docs/          Architecture, plan, testing strategy (already imported)
.github/       GitHub Actions
```

## Requirements

- **Node.js**: `^24` (Active LTS). See `.nvmrc` — `nvm use` picks it up.
- **pnpm**: `>=9` (corepack-managed).
- **Postgres / Redis**: not required for the scaffold. Wired in MC-002.

## Common commands

Run all of these from the repository root.

```bash
# Install dependencies across the workspace
pnpm install

# Start all dev servers in parallel (web:3000, api:3001, worker)
pnpm dev

# Run the full pipeline (lint → typecheck → test → build)
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build

# Run a single workspace
pnpm --filter @multichef/api test
pnpm --filter @multichef/web dev

# Wipe all build artifacts and node_modules
pnpm clean
```

## Smoke checks

After `pnpm install && pnpm dev`, the scaffold should respond:

- `http://localhost:3000/` — Next.js landing page (`MULTI-CHEF`).
- `http://localhost:3001/api/v1/health/live` — `{"status":"ok"}`.
- `apps/worker` — logs `worker ready` to stdout.

## Conventions

- TypeScript: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
  (see `tsconfig.base.json`).
- Linting: ESLint v9 flat-config shared via `@multichef/eslint-config`.
- Formatting: Prettier 3.
- Commit messages: Conventional Commits (full policy in MC-005).
- Money fields are integers (cents); nutrients are decimals. Zero `Float` for
  money. (Enforced in MC-003.)

## Security

- Secrets are **never** committed. `.env.example` uses placeholders; real
  values live in `/etc/multichef/*.env` on the production host and
  `~/.deploy-secrets/multichef/INVENTORY.md` on the manager host.
- gitleaks will be wired in MC-005 (pre-commit + CI).
