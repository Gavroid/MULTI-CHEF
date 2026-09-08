# ADR-0009: NestJS 11 (не 10)

## Status

**Accepted**

## Date

**2026-09-08**

## Context

План DEVELOPMENT-PLAN подразумевал Nest 10 (через '@nestjs/*': '^10.x'). MC-001 поставил Nest 11 — обнаружилось 8 high-vuln advisories в Nest 10 (middleware/auth-bypass).

## Decision

NestJS 11 (текущая LTS-линия).

## Consequences

### Positive

- Закрыты 8 high-vuln advisories из Nest 10
- Современный API (Nest 11 вышел в январе 2025)
- Долгосрочная поддержка

### Negative

- Минимальный риск: некоторые community-плагины могут быть несовместимы

### Neutral

- Раздел в плане про 'Nest 10' интерпретируется как 'актуальная LTS-линия NestJS'
