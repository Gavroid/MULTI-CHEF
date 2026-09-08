# ADR-0004: BullMQ для длинных операций

## Status

**Accepted**

## Date

**2026-09-08**

## Context

PM-prompt #6: длинные операции (генерация плана, сборка списка, prep-сессия) — только асинхронно через BullMQ job. HTTP-запрос не длится > 5 сек. Возможные варианты — BullMQ + Redis, AWS SQS, RabbitMQ, встроенные NestJS workers.

## Decision

BullMQ как очередь, Redis 7 как брокер. Отдельный процесс `apps/worker` (systemd-юнит `multichef-worker` в проде, ADR-0006). Polling-based API для статусов: `GET /api/v1/jobs/:id` возвращает текущий статус из Postgres-зеркала (модель Job).

## Consequences

### Positive

- Идемпотентность jobs (повторный запуск не плодит планы) — см. PRD §4.8
- Retry с exponential backoff из коробки
- Отслеживание прогресса (progress, stage) через модель Job
- Не блокирует HTTP-воркер — отдаёт 202 Accepted за <100ms

### Negative

- Требует Redis как обязательную зависимость
- Дополнительный сервис для мониторинга (Bull-Board в MC-074)

### Neutral

- В dev — Redis 7 alpine через compose.yml
