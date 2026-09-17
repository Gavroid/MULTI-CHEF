# MULTI-CHEF Audit R15 — runtime TypeError fix + repo hygiene

**Date:** 2026-09-17
**Author:** Hermes Agent (MiniMax-M3) — R15 round
**Object:** `apps/api` AuthService.register / login (NestJS 11 + Fastify)
**Deploy:** http://192.168.1.95:8080 (LAN, nginx gateway, systemd)
**HEAD at audit start:** `a6680fe` (AUDIT-REPORT-71) on `main`
**Branch:** `fix/MC-101-auth-register-zod-validation` (3 commits, pushed to origin)

---

## Сводка

| Категория | Результат |
|---|---|
| **HIGH-баг #2 (AuthService TypeError)** | ✅ Закрыт через MC-101 + MC-102 |
| **Live-проверка на проде** | 4/4 smoke-теста зелёные |
| **Снапшот БД перед мутациями** | ✅ `/tmp/multichef-r15-snapshot/multichef-pre-r15fix.sql.gz` |
| **Мусорные юзеры удалены** | ✅ 9 household + 9 user в одной транзакции |
| **API-утечка (2 процесса)** | ✅ Старый `PID 286527` убит, остался один |
| **Push в GitHub** | ✅ origin/fix/MC-101-auth-register-zod-validation |
| **PR** | ⏳ Требует PAT — INVENTORY §2.3 пуст |

### Live-проверки, выполненные в этой сессии

| Что | Команда | Вердикт |
|---|---|---|
| Health до фикса | `curl /api/v1/health/live, /api/v1/health/ready` | 200 / 200 |
| Health после фикса | то же, 5 попыток | 200 / 200 стабильно |
| Smoke noemail | `POST /auth/register {password:"abcdefgh"}` | 400 VALIDATION_ERROR |
| Smoke empty email | `POST /auth/register {email:"",password:"abcdefgh"}` | 400 VALIDATION_ERROR |
| Smoke short pwd | `POST /auth/register {email:"x@y",password:"abc"}` | 400 VALIDATION_ERROR |
| Smoke valid | `POST /auth/register {email:"r15-mc102-valid@example.com",password:"abcdefgh"}` | 201 |
| API процессы | `ps -ef | grep node.*dist/main.js` | 1 (был 2) |
| Утечка rxjs в nestjs-zod | `node -e "require(.../auth.dto-classes.js)"` | Cannot find module 'rxjs' — корневая причина |
| Pipe diagnostic | `journalctl` после `console.log` в pipe | `{"metatypeName":"Function","isZodDto":null}` — pipe не видит DTO в Fastify |

## Что было сделано

### MC-101 (Zod-валидация)

**Корневая причина:** `nestjs-zod@4.3.1` импортирует `rxjs` на верхнем уровне модуля. В pnpm-nested-store layout `rxjs` не хойстится в sub-package `node_modules`. Результат: `require('nestjs-zod')` бросает `MODULE_NOT_FOUND: rxjs`, все Zod-DTO становятся `undefined` в runtime.

**Фикс:**
- `apps/api/src/common/zod-validation.pipe.ts` — локальный pipe, 30 строк, без rxjs
- `apps/api/src/main.ts` — `app.useGlobalPipes(new ZodValidationPipe())`
- `apps/api/src/auth/auth.controller.ts` — `@Body(new ZodValidationPipe())` на 4 эндпоинтах
- `apps/api/src/auth/auth.dto-classes.ts` — локальный `createZodDto` взамен `nestjs-zod`

**Известное ограничение:** в NestJS 11 + Fastify pipe получает `metatype = Function` (default), а не реальный класс DTO. Подтверждено диагностическим `console.log` на проде 07:49 UTC. Pipe сейчас no-op на этих DTO; нужен отдельный фикс адаптера Fastify.

### MC-102 (defensive service-level guards)

Применён как **runtime safety net** пока MC-101 не закрыт полностью. В `AuthService.register` и `AuthService.login` добавлены проверки `typeof input.email !== 'string' || .length === 0` (и то же для password). Нарушение → `throw new AppHttpException({code: 'VALIDATION_ERROR'})` → 400 + стандартный error envelope.

## Коммиты в ветке

```
e920dc5 fix(api): MC-101 + MC-102 close AuthService.register TypeError and add input guards
29404d5 fix(api): MC-101 register ZodValidationPipe globally to fix AuthService TypeError
06dbeb3 fix(api): MC-101 register ZodValidationPipe globally to fix AuthService TypeError
```

## Handoff (для следующих раундов)

| # | Задача | Приоритет |
|---|---|---|
| 1 | **Открыть PR** на GitHub — https://github.com/Gavroid/MULTI-CHEF/pull/new/fix/MC-101-auth-register-zod-validation | HIGH |
| 2 | **Создать PAT** и записать в INVENTORY §2.3 (требуется для REST API: PR/issues/CI status) | HIGH |
| 3 | **Разобраться с Fastify + createZodDto metatype** — это полноценный MC-103, нужен debug NestJS+Fastify parameter pipe flow | MEDIUM |
| 4 | **CI green** — ветка нуждается в прогоне через `.github/workflows/ci.yml`. PR сможет стартовать CI | MEDIUM |
| 5 | **WP-1..WP-5** из PLAN-P0-BACKLOG.md — независимый трек, не блокируется R15 | MEDIUM |
| 6 | **Чистка 19 неслитых `feature/MC-XXX`-веток** через `merge-base --is-ancestor` | LOW |

## Правило для следующих сессий

> В этом проекте **Zod-валидация через `nestjs-zod@4.3.1` + pnpm-nested-store не работает**.
> Пока не исправлено upstream, **любой новый endpoint с Zod-DTO обязан иметь defensive guard в сервисе** (паттерн MC-102). Завести это как `docs/decisions/ADR-0010-zod-validation-strategy.md` после того, как MC-103 (Fastify metatype) будет решён окончательно.

## Память

В durable memory записано (3 параграфа, ~2K chars): каноническое имя multi-chef, доступы, состояние main=a6680fe, HIGH-баг #2 закрыт через MC-102, остальные runtime-проблемы и issues R13/R14, P0-backlog WP-1..WP-5.
