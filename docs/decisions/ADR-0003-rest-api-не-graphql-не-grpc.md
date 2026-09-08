# ADR-0003: REST API (не GraphQL, не gRPC)

## Status

**Accepted**

## Date

**2026-09-08**

## Context

Frontend — Next.js с мобильным трафиком, основные клиенты — PWA на телефонах с нестабильным соединением. Возможные варианты — REST, GraphQL, gRPC, tRPC.

## Decision

REST API поверх HTTP/1.1 + JSON. Префикс `/api/v1`. OpenAPI спецификация генерируется автоматически (NestJS Swagger) и доступна по `/api/v1/docs`. Базовый URL: `API_PORT` (по умолчанию 3001) на localhost через Nginx gateway (MC-071).

## Consequences

### Positive

- Кеширование через CDN (Cloudflare/Fastly) — REST это поддерживает нативно
- Простота для мобильных клиентов с плохим соединением — короткие запросы без overhead GraphQL
- Стандартные инструменты (curl, Postman, браузер)
- OpenAPI автогенерация → единый источник правды для frontend и backend

### Negative

- Overfetching/underfetching на сложных экранах — решается через композитные endpoint'ы (MC-040+)
- Версионирование требует явной координации (`/api/v2`)

### Neutral

- Idempotency-Key обязателен для всех мутаций — см. conventions.md §3
