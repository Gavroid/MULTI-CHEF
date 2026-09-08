# ADR-0012: Household.ownerId = RESTRICT (каскад только для HouseholdMember)

## Status

**Accepted**

## Date

**2026-09-08**

## Context

MC-003 требовал выбора onDelete для Household.ownerId. PRD не специфицирует. Возможные варианты — RESTRICT (default, безопасный), CASCADE (удаление user удаляет household), SET NULL (orphan household).

## Decision

RESTRICT — пользователь не может быть удалён, пока владеет household. Каскад на HouseholdMember (если user покидает household — запись удаляется). Это даёт возможность reassign ownership перед удалением user.

## Consequences

### Positive

- Безопасный default — данные не теряются
- Явный reassign перед удалением — хорошая практика
- Integration test покрывает оба сценария

### Negative

- API для удаления user должен явно обрабатывать этот случай (MC-010+)

### Neutral

- HouseholdMember остаётся cascade — это явное требование к household membership
