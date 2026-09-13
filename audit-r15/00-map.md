# R15 — Карта проекта

Размер: API 81, Web 117, Worker 8, packages 101 TS/TSX файлов.
Node 24, pnpm 9, Next 15.1, React 19, NestJS 11 + Fastify, Prisma 6 + adapter-pg, BullMQ 5+, Argon2id, Zod nestjs-zod, ioredis.

## Domains (apps)

- **api** (NestJS+Fastify :3001) → глобальные guards CSRF+Idempotency+Throttler. Localhost:127.0.0.1, троттлер proxy trust true (R13-H1 ещё не пофикшен).
- **web** (Next.js 15 App Router :3000) → 5 табов (Сегодня/Холодильник/План/Покупки/Профиль) + /auth/login/register + /design + 9 подмаршрутов. SSR + 'use client' mix.
- **worker** (BullMQ loop) → runPlanWeek + транзакция MealPlan+Days+Entries+ShoppingList, idle loop.

## packages (101 файлов)

- `contracts/` Zod-схемы + TS-типы (источник истины DTO)
- `database/` Prisma client + seed
- `nutrition/` Decimal compute + scale + rounding
- `recommendation/` planner + filters + scoring + shopping
- `ui/` Button/Card/Skeleton/TabTitle/Toast/etc design-system
- `config/` env loader + validation
- `eslint-config`, `typescript-config` — общие.

## Cross-layer contracts

1. Web fetch → API `/api/v1/*`. Cookies mc_session + mc_csrf.
2. Web → POST /meal-plans → 202 + {jobId} (BullMQ enqueue).
3. Worker читает BullMQ, через `loadAndPlan` прокачивает `GenerationContext → planWeek`, транзакционно пишет в Postgres.
4. Web полл `/jobs/:id` → COMPLETED → GET /meal-plans/active.
5. RAG/ingredients в `apps/api/src/ingredients` (без AuthGuard).

## Routing

`/api/*` → nginx → 127.0.0.1:3001
`/` (any) → 127.0.0.1:3000 (Next)
`/api/v1/docs` включено dev, закрыто prod (R13)
`
