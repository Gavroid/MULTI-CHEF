# ADR-0007: Implementation Roadmap Фазы 0 — последовательная

## Status

**Accepted**

## Date

**2026-09-08**

## Context

MC-001..MC-005 — фундамент monorepo. PM-prompt §ПАРАЛЛЕЛЬНОСТЬ говорит 'после Фазы 0'. Возможные варианты — строго последовательная (один владелец), параллельная по трекам (backend/frontend), или смешанная.

## Decision

Фаза 0 — СТРОГО последовательная. Единственный владелец — backend-bot. frontend-bot не задействован до MC-012. qa-docs-bot подключается на MC-004 (соавтор) и MC-005 (ревью). Параллельность разрешена только в Фазе 1+.

## Consequences

### Positive

- Нет merge-конфликтов на общем каркасе (pnpm-workspace.yaml, turbo.json, schema.prisma)
- pnpm-lock.yaml не расходится
- Чистая история git — каждый MC = один PR

### Negative

- Фаза 0 занимает 24-31 ч суммарно (vs параллельный вариант ~12-15 ч)

### Neutral

- Зафиксировано в /root/.hermes/plans/multichef-phase-0.md
