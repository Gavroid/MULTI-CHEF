# ADR-0005: Планировщик — TS-эвристика (не LLM, не solver)

## Status

**Accepted**

## Date

**2026-09-08**

## Context

PM-prompt #4: КБЖУ/аллергены/сроки/цены — только детерминированный код. LLM — только за интерфейсом AiProvider с детерминированным fallback (TemplateAiProvider) и валидацией вывода Zod. Для планировщика недельного меню возможные варианты: TS-эвристика (greedy + локальные swaps), полноценный solver (CP-SAT, OR-Tools), или LLM.

## Decision

TS-эвристика: greedy-фаза + локальные swaps для оптимизации КБЖУ и бюджета. Реализация в `packages/planner` (MC-051). Тесты — fixture-тесты с известным планом (точный вывод).

## Consequences

### Positive

- Детерминированный — один и тот же вход даёт один и тот же план (важно для тестов и воспроизводимости)
- Быстрый — 7 дней × 3 приёма за <60 сек (PRD §5.2)
- Не требует GPU или внешних API
- Простой аудит — обычный TypeScript, читается линейно

### Negative

- Может быть suboptimal vs CP-SAT — допустимо для MVP (PRD §5.5)
- Расширение до solver потребует ADR

### Neutral

- Покрывается fixture-тестами в `packages/planner/__tests__/` (MC-051 DoD)
