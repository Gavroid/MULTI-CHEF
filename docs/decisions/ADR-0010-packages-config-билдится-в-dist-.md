# ADR-0010: packages/config билдится в dist/

## Status

**Accepted**

## Date

**2026-09-08**

## Context

apps/web/next.config.mjs импортирует @multichef/config через `import { loadWebEnv } from '@multichef/config'`. Next.js парсит этот файл через SWC + Node ESM resolver, которые НЕ резолвят workspace TS source напрямую.

## Decision

`packages/config` билдится в `dist/` (tsconfig.build.json). apps/web импортирует собранный JS через `dist/index.js`. Turbo pipeline с `dependsOn: ['^build']` гарантирует что @multichef/config#build выполняется перед apps/web#build.

## Consequences

### Positive

- Работает с любыми tooling (Next.js, Jest, Vitest) — они все резолвят JS
- Чёткий pipeline build → test → deploy

### Negative

- Нужен явный build step перед запуском
- Dev-loop требует `pnpm build` или watch-режим

### Neutral

- Альтернатива (inline env в next.config.mjs) отклонена: теряем типизацию
