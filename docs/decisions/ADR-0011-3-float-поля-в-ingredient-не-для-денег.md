# ADR-0011: 3 Float поля в Ingredient (не для денег)

## Status

**Accepted**

## Date

**2026-09-08**

## Context

DoD MC-003: '0 матчей Float|Real|Double'. PRD §3.2 для Ingredient задаёт Float для density (g/ml), ediblePartRatio (0..1), packageSize (units). PM-prompt #5 говорит только про деньги: 'Денежные суммы — целые копейки (Int), никогда float. Питательные значения — Decimal.'

## Decision

Float для физических констант (density, ediblePartRatio, packageSize) — допустимо, так как они НЕ являются денежными или питательными. Все денежные поля — Int (kopecks). Все питательные — Decimal.

## Consequences

### Positive

- Соответствует PRD §3.2 без модификации схемы
- Float адекватен для физических констант с ограниченной точностью

### Negative

- При grep 'Float' в schema.prisma будет 3 матча — требует комментария-обоснования

### Neutral

- Миграция использует DOUBLE PRECISION (эмиссия Prisma Float) — это нормально
