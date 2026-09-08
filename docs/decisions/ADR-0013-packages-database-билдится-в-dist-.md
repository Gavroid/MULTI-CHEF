# ADR-0013: packages/database билдится в dist/

## Status

**Accepted**

## Date

**2026-09-08**

## Context

MC-003: apps/api импортирует pingDatabase из @multichef/database. Та же проблема что и с @multichef/config (ADR-0010) — workspace symlink резолвится в src/index.ts, но Node ESM не читает .ts.

## Decision

`packages/database` тоже билдится в `dist/`. apps/api импортирует собранный JS. Turbo pipeline с `dependsOn: ['^build']` гарантирует порядок.

## Consequences

### Positive

- Единообразие с ADR-0010 — оба workspace-пакета с кодом билдятся в dist/
- Работает с NestJS/Fastify tooling

### Negative

- Дополнительный build step для database пакета

### Neutral

- Pure-data пакеты (contracts, eslint-config, typescript-config) не требуют build — только exports TS source
