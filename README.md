# MULTI-CHEF

[![CI](https://github.com/Gavroid/MULTI-CHEF/actions/workflows/ci.yml/badge.svg)](https://github.com/Gavroid/MULTI-CHEF/actions/workflows/ci.yml)

MULTI-CHEF monorepo. This repository hosts the production code for the
project described in `docs/MULTICHEF-ARCHITECTURE-PRD.md`,
`docs/MULTICHEF-DEVELOPMENT-PLAN.md`, and `docs/MULTICHEF-TESTING-STRATEGY.md`.

See `docs/CONTRIBUTING.md` for the working agreement (mandatory checks, scope
rules, commit conventions) and `docs/api/conventions.md` for the HTTP API
contract. Architecture decisions live in `docs/decisions/`.

## Status

- Phase: **1 — web frontend (MC-010 auth, MC-011 profile, MC-012 design system, MC-013 app-shell merged; MC-014 auth screens next)**
- Deployment model: systemd bare-metal (ADR-0006)
- CI: 5-job pipeline (lint / typecheck / test / build / secret-scan) with pgvector for integration tests

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

- `http://localhost:3000/` — Public landing (Войти / Создать аккаунт CTAs).
- `http://localhost:3000/today` (and `/fridge`, `/plan`, `/shopping`, `/profile`) —
  App shell with fixed BottomTabBar (5 tabs, 64px + iOS safe-area). Guests
  can browse; `/profile` redirects to `/auth/login` without `mc_session`.
- `http://localhost:3000/auth/login` (and `/auth/register`) — Auth screens
  (stubs in MC-013; full flow in MC-014).
- `http://localhost:3000/design` — Design-system demo: every UI primitive
  in every state.
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

## Documentation

- `docs/MULTICHEF-ARCHITECTURE-PRD.md` — product, UI/UX, schema, API contracts,
  infrastructure (§6). Canonical for "what we're building".
- `docs/MULTICHEF-DEVELOPMENT-PLAN.md` — 34 MC-tasks with DoD, estimates,
  dependency graph. Canonical for "when we're building".
- `docs/MULTICHEF-TESTING-STRATEGY.md` — testing pyramid, fixture-tests,
  G1–G8 release gates. Canonical for "how we verify".
- `docs/api/conventions.md` — HTTP API contract (errors, pagination,
  idempotency, IDs, money).
- `docs/decisions/ADR-NNNN-*.md` — 13 architectural decisions (Phase 0).
  Every deviation from a decision requires a new ADR.

## Known issues

- `apps/web/next.config.mjs` has `devIndicators: false` — workaround for an
  upstream bug in Next.js 15.5 devtools under pnpm workspaces. Production
  build is clean. Re-evaluate when upgrading to Next 15.6+.
- `packages/config` and `packages/database` build to `dist/` (ADR-0010,
  ADR-0013). Next.js and the workspace TS resolver do not read `.ts`
  directly, so we ship built artefacts. `turbo run build` orders them
  correctly via `dependsOn: ['^build']`.

## Contributing

Read `docs/CONTRIBUTING.md` first. It covers:

- mandatory pre-commit checks (`pnpm lint && format:check && typecheck &&
test && build`);
- the ban on `db push` in production (only `prisma migrate deploy`);
- the no-secrets rule across chat, logs, commits, screenshots;
- the rule that scope expansion or library changes require an ADR plus
  operator approval;
- Conventional Commits + Conventional PR titles;
- how to run CI locally (and why Docker is required for `test:integration`).

Issues and PRs follow the templates in `.github/` (added in MC-005).
