# ADR-0001: Monorepo (pnpm + Turborepo)

## Status

**Accepted**

## Date

**2026-09-08**

## Context

MULTI-CHEF — full-stack проект с frontend (Next.js), backend (NestJS+Fastify), worker, и несколькими общими пакетами (contracts, database, config, ui). Возможные варианты — monorepo (pnpm + Turborepo), polyrepo (отдельные репозитории для каждого app), или monolith-frontend-only (один Next.js с API routes).

Polyrepo усложняет разработку: изменения в API контрактах требуют синхронных PR в двух репозиториях, общие типы приходится публиковать как npm-пакет, CI приходится запускать дважды. Monolith-frontend-only теряет возможность переиспользовать доменные пакеты (packages/nutrition, packages/recommendation) и не масштабируется для worker-приложения.

## Decision

Использовать monorepo: pnpm workspaces + Turborepo. Структура: apps/{web,api,worker}, packages/{contracts,database,config,ui,eslint-config,typescript-config}. TypeScript strict (включая noUncheckedIndexedAccess, exactOptionalPropertyTypes) на уровне tsconfig.base.json.

## Consequences

### Positive

- Один репозиторий — один PR может покрыть изменения в API контрактах, фронтенде и общем пакете
- pnpm workspaces — быстрый install, жёсткий контроль версий, экономия диска
- Turborepo — кеширование результатов pipeline (lint/typecheck/test/build) между ветками
- Общие tsconfig/eslint-config — единый стиль кода в monorepo

### Negative

- Сложнее управлять зависимостями (cyclic deps, hoisting)
- Lock-файл pnpm-lock.yaml может расходиться при параллельной работе — Фаза 0 запрещает параллельные install (ADR-0007)

### Neutral

- Требуется Node 24 LTS и pnpm 9.x — оба зафиксированы в .nvmrc и packageManager
