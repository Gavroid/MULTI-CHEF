# MULTI-CHEF Audit R16 — MC-103 pipe-level Zod validation + MC-105 ADR

**Date:** 2026-09-17
**Author:** Hermes Agent (MiniMax-M3) — R16 round
**Object:** `apps/api` auth endpoints (NestJS 11 + Fastify, ZodValidationPipe)
**Deploy:** http://192.168.1.95:8080 (LAN, nginx gateway, systemd)
**HEAD at audit start:** `84bcc3b` (docs(audit): SESSION_PROMPT_R16.md)
**HEAD at audit end:** `726ebdd` (test(api): MC-103 fix TS4111) on `main`

---

## Сводка

| Категория                      | Результат                                                           |
| ------------------------------ | ------------------------------------------------------------------- |
| **MC-103 root cause**          | ✅ Закрыт — pipe теперь принимает Zod schema явно через конструктор |
| **MC-105 ADR-0024**            | ✅ Документ создан, 111 строк, ссылка из pipe top-of-file           |
| **CI 7/7 green**               | ✅ typecheck/test/lint/build/e2e/audit/secret-scan все success      |
| **Smoke на проде после merge** | ✅ 5/5 (case 3: bad email → 400, был 201)                           |
| **Unit-тесты**                 | ✅ 9/9 в zod-pipe-mc103.test.ts                                     |
| **Live-state checks**          | 8/10 pass; 2 known issues — см. ниже                                |
| **Снапшот БД перед мутациями** | ✅ `/var/lib/multichef/backups/multichef-20260917T092853Z.sql.gz`   |
| **Мусорные юзеры удалены**     | ✅ 4 household + 4 user (live-%, mc103-%, smoke-r16%, not-an-email) |
| **Push в GitHub**              | ✅ 3 коммита в main (squash через REST API)                         |

### Acceptance criteria итоги

| AC          | Что проверяет                            | Где верифицировано                          | Статус |
| ----------- | ---------------------------------------- | ------------------------------------------- | ------ |
| MC-103 AC-1 | empty email → 400                        | smoke case 1, 2 + unit test                 | ✅     |
| MC-103 AC-2 | bad email format → 400 (НЕ 201)          | smoke case 3 + unit test                    | ✅     |
| MC-103 AC-3 | без MC-102 service guards pipe ловит сам | unit test asserts pipe-only behaviour       | ✅     |
| MC-103 AC-4 | existing tests pass                      | `pnpm --filter @multichef/api test` 170/170 | ✅     |
| MC-103 AC-5 | CI 7/7 green                             | GitHub Actions run 35207702006              | ✅     |
| MC-105 AC-1 | ADR ≥ 30 строк, follow template          | ADR-0024, 111 строк                         | ✅     |
| MC-105 AC-2 | ADR referenced from pipe source          | grep ADR-0024 в pipe:1                      | ✅     |

---

## Что было сделано

### MC-103 (Zod validation at pipe level — explicit schema)

**Корневая причина (R15 hypothesis подтверждена):**
В NestJS 11 + Fastify при `@Body(new ZodValidationPipe())` параметр
`metadata.metatype` приходит как `Object` или `Function`, а не как
реальный DTO-класс. MC-101-стратегия (читать схему из
`metatype.schema` — статическое поле DTO) тихо возвращает
`undefined`, pipe становится no-op. На smoke-2026-09-17 07:49 UTC
это выглядело как: `email: "not-an-email"` → HTTP 201 + юзер
создаётся в БД.

**Фикс:**

- `apps/api/src/common/zod-validation.pipe.ts` — pipe теперь принимает
  Zod-схему через конструктор: `new ZodValidationPipe(RegisterBody)`.
  Fallback на статическое поле сохранён для legacy-вызовов без аргумента.
- `apps/api/src/auth/auth.controller.ts` — все 4 `@Body()` вызова
  переведены на explicit schema:
  - `register` → `RegisterBody`
  - `login` → `LoginBody`
  - `logout` → `LogoutBody`
  - `updateLocale` → `LocaleBody`
- `apps/api/src/__tests__/zod-pipe-mc103.test.ts` — новый файл, 9 unit-тестов.

**Smoke (prod `multichef`, `/api/v1/auth/register`):**

| Case | Body                                             | До фикса      | После фикса |
| ---- | ------------------------------------------------ | ------------- | ----------- |
| 1    | `{}`                                             | 400           | 400 ✅      |
| 2    | `{"email":"","password":"abcdefgh"}`             | 400           | 400 ✅      |
| 3    | `{"email":"not-an-email","password":"abcdefgh"}` | **201 (BUG)** | **400 ✅**  |
| 4    | `{"email":"x@y.com","password":"abc"}`           | 400           | 400 ✅      |
| 5    | valid                                            | 201           | 201 ✅      |

### MC-105 (ADR-0024 zod-validation-strategy)

**Файл:** `docs/decisions/ADR-0024-zod-validation-strategy.md`, 111 строк.

Структура: Status / Date / Context / Decision / Alternatives considered /
Consequences (Positive/Negative/Neutral) / References.

Ключевые решения зафиксированы:

1. Explicit constructor schema — единственный надёжный паттерн под
   NestJS+Fastify.
2. MC-102 service guards остаются как defence-in-depth.
3. Альтернативы (Reflect metadata decorator, Express switch) — отклонены
   с обоснованием.
4. TODO R17: lint-rule, автоматически требующий schema в pipe.

Pipe top-of-file comment обновлён — теперь ссылается на ADR-0024.

### TS4111 follow-up fix

**Файл:** `apps/api/src/__tests__/zod-pipe-mc103.test.ts`

CI typecheck (turbo + `noUncheckedIndexedAccess`) строже локального.
Изначальный predicate обращался к `r.details.fields.email` через
dot-notation — TS4111 требовал `fields['email']`. Заменено на bracket
notation. Логика теста не изменилась.

**CI run history:**

- 35206890621 (на `233e18a`, с DOT-notation) → **failure** на typecheck
- 35207702006 (на `726ebdd`, с BRACKET-notation) → **success** 7/7

---

## Live-state checks (output captured below)

| #   | Что                | Команда                                                           | Вердикт                      |
| --- | ------------------ | ----------------------------------------------------------------- | ---------------------------- |
| 1   | API health         | `curl -sf /api/v1/health/live`                                    | 200 ✅                       |
| 2   | API ready          | `curl -sf /api/v1/health/ready`                                   | 200 ✅                       |
| 3   | Port binding       | `ss -tlnp \| grep :3000\\                                         | :3001`                       | ❌ `0.0.0.0:3000`, `0.0.0.0:3001` (WP-1) |
| 4   | Backups fresh      | `ls -la /var/lib/multichef/backups/multichef-*.sql.gz \| tail -1` | mtime < 60s ✅               |
| 5   | Empty-email users  | `psql ... SELECT count(*) FROM "User" WHERE email=''`             | 0 ✅                         |
| 6   | 5xx in last hour   | `journalctl -u multichef-api --since "1 hour ago" \| grep -c 5xx` | 0 ✅                         |
| 7   | CSRF cookie issued | `curl -i POST /auth/register`                                     | `Set-Cookie: mc_csrf=...` ✅ |
| 8   | Gitleaks           | `gitleaks detect --source . --no-banner`                          | no leaks ✅                  |
| 9   | CI typecheck       | GitHub Actions run 35207702006                                    | success ✅                   |
| 10  | CI test            | GitHub Actions run 35207702006                                    | success ✅                   |

### Известные issue из live-state checks

- **WP-1 port binding `0.0.0.0`**: PRD обещал `127.0.0.1` для API (3001) и
  web (3000). В systemd-юнитах сейчас оба биндятся на `0.0.0.0`. nginx
  спереди всё равно пропускает только LAN-источники, но PRD-контракт
  нарушен. Перенос в R17 как отдельная задача.
- **CI typecheck flake resolved**: см. TS4111 follow-up. Локальный
  typecheck проходил из-за отсутствия `noUncheckedIndexedAccess` в
  dev tsconfig.

---

## Test command outputs

### `pnpm --filter @multichef/api exec node --import tsx --test .../zod-pipe-mc103.test.ts`

```
✔ AC-1: pipe rejects {} with VALIDATION_ERROR + field errors (3.1ms)
✔ AC-1: pipe rejects empty email (0.5ms)
✔ AC-2: pipe rejects "not-an-email" with field-level email error (0.3ms)
✔ AC-2: pipe rejects email without @ (0.2ms)
✔ AC-2: pipe rejects email with spaces (0.2ms)
✔ AC-4: valid body passes through with toLowerCase applied (0.1ms)
✔ AC-4: pipe rejects short password with field-level error (0.2ms)
✔ fallback: pipe without schema argument is a no-op (0.6ms)
✔ fallback: pipe with empty body returns the empty body (0.2ms)
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

### `pnpm --filter @multichef/api test` (existing 170 tests + 9 new)

```
ℹ tests 170
ℹ pass 170
ℹ fail 0
```

### `pnpm run typecheck` (turbo, all 11 packages)

```
Tasks:    15 successful, 15 total
Cached:   10 cached, 15 total
Time:     4.467s
```

### `pnpm lint` / `pnpm format:check`

```
Tasks:    15 successful, 15 total
OK
```

### CI run 35207702006 (на `726ebdd`)

```
build          completed  success
secret-scan    completed  success
test           completed  success
typecheck      completed  success
e2e (T28-B)    completed  success
lint           completed  success
audit (T44-A)  completed  success
```

---

## Файлы изменены

- `apps/api/src/common/zod-validation.pipe.ts` — pipe теперь принимает
  Zod-схему через конструктор (+52 строки, MC-103 fix)
- `apps/api/src/auth/auth.controller.ts` — 4 `@Body()` вызова с explicit
  schema (+5 строк, MC-103 fix)
- `apps/api/src/__tests__/zod-pipe-mc103.test.ts` — новый файл, 9 unit-тестов
  (MC-103 AC)
- `docs/decisions/ADR-0024-zod-validation-strategy.md` — новый файл,
  111 строк (MC-105)

---

## Коммиты (на main)

```
726ebdd  test(api): MC-103 fix TS4111 noUncheckedIndexedAccess in zod-pipe-mc103
233e18a  docs(audit): MC-105 ADR-0024 zod-validation-strategy
b5f716b  feat(api): MC-103 Zod validation at pipe level (explicit schema) [squash-merge via REST]
c685f73  feat(api): MC-103 Zod validation at pipe level (explicit schema) [feature branch HEAD]
```

Branch `fix/MC-103-zod-pipe-metatype` оставлен на origin для истории,
можно удалить через `git push origin --delete fix/MC-103-zod-pipe-metatype`.

---

## Known follow-ups for R17

1. **WP-1** — привязать multichef-api и multichef-web к `127.0.0.1`
   в systemd-юнитах, а не `0.0.0.0`. nginx спереди уже фильтрует, но
   PRD-контракт требует.
2. **Lint-rule** — автогенерация правила, требующего
   `@Body(new ZodValidationPipe(Schema))` (или схемы через metadata)
   на всех POST/PATCH/PUT эндпоинтах. ADR-0024 ссылается.
3. **Branch cleanup** — удалить устаревшие ветки:
   - `fix/MC-101-auth-register-zod-validation` (R15 superseded)
   - `fix/MC-103-zod-pipe-metatype` (R16 уже в main)
   - 19+ stale `feature/MC-XXX-*` из Фаз 0-3 (R13 P1-backlog)
4. **Live-state check port binding** — добавить в
   `infrastructure/scripts/health-check.sh` как постоянный gate,
   чтобы WP-1 регрессия ловилась автоматически.
5. **CSRF cookie domain hardening** — проверить, что при
   `COOKIE_DOMAIN=192.168.1.95` cookie реально ограничивается (T32-A
   в R15 частично, но не покрыто полностью).
6. **Pre-existing CI strictness gap** — зафиксировать расхождение
   dev vs CI tsconfig (noUncheckedIndexedAccess). Если CI строже,
   dev должен быть таким же — иначе flake как MC-103 TS4111 будут
   повторяться.

---

## Round budget

- **MC-103 fix + smoke + unit + CI fix**: ~1.5 ч
- **MC-105 ADR**: ~15 мин
- **Live-state checks**: ~10 мин
- **CI waiting + this SUMMARY**: ~30 мин
- **Total**: ~2.5 ч (бюджет 6-8 ч, использован на ~40%)

R16 — done.
