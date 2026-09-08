# ADR-0002: PostgreSQL 16 (не MySQL, не MongoDB)

## Status

**Accepted**

## Date

**2026-09-08**

## Context

MULTI-CHEF требует ACID-транзакции (денежные операции, генерация плана покупок), сложных индексов (GIN trigram для поиска ингредиентов, частичный уникальный для ACTIVE MealPlan, GIN для tags), и расширений (pg_trgm, unaccent, vector для будущего AI). Возможные варианты — PostgreSQL 16, MySQL 8, MongoDB.

## Decision

Использовать PostgreSQL 16 (alpine в dev/Compose, нативная установка в проде через ADR-0006).

## Consequences

### Positive

- pg_trgm + GIN-индексы — быстрый поиск ингредиентов с опечатками и алиасами
- Частичный уникальный индекс (partial unique) — нативная поддержка 'один ACTIVE план на household'
- vector (pgvector) — будущий AI-поиск рецептов по embeddings
- ACID, FK, JSON-поля — всё нативно

### Negative

- Требует ручной установки pgvector на уровне системы (не только CREATE EXTENSION)
- PostgreSQL сложнее в эксплуатации чем MySQL (но MySQL не имеет pg_trgm/vector)

### Neutral

- В dev используется alpine image, в проде — нативная установка через apt
