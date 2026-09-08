# ADR-0006: Systemd bare-metal в проде

## Status

**Accepted**

## Date

**2026-09-08**

## Context

PM-prompt §Среда и доступы: модель деплоя — systemd bare-metal. ADR-0006 был озвучен в PM-prompt, но не задокументирован. Возможные варианты — Docker Compose в проде, Kubernetes, systemd bare-metal, hybrid (Docker для приложений, host для БД).

## Decision

Systemd bare-metal. PostgreSQL 16 + Redis 7 — нативные пакеты на multichef (192.168.1.95). Next.js standalone-сборка в `/var/lib/multichef/web/`. Три systemd-юнита: `multichef-web`, `multichef-api`, `multichef-worker` под юзером `multichef_app`. Nginx как gateway на :80/:443 с проксированием на 127.0.0.1:3000/3001 (MC-071). Docker используется ТОЛЬКО для dev и Testcontainers.

## Consequences

### Positive

- Прямой контроль над процессами — systemctl, journalctl, restart policies
- Нет overhead слоя контейнеризации в проде
- PostgreSQL с pgvector ставится нативно (apt install postgresql-16-pgvector)
- Простой аудит через auditd

### Negative

- Не переносимо между облаками напрямую (требует LXC/KVM с systemd)
- Развёртывание требует Ansible/systemd знаний

### Neutral

- Docker Compose остаётся в dev для testcontainers и воспроизводимости среды
