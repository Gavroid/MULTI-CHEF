# FIXES-13-20: верификация исправлений (аудиты #13–#20)

**Дата:** 2026-09-14
**HEAD:** `6673606 fix(api): quote-stripped P2002 target matching`
**Развёртывание:** прод-сервисы `multichef-api` / `multichef-worker` перезапущены на новом билде (2 рестарта: базовый деплой + деплой hotfix `6673606`), `systemctl is-active` = active/active, `health/ready` = 200.

Аналог `VERIFICATION.md` (который верифицировал круг #3) — здесь зафиксированы воспроизводимые доказательства закрытия находок кругов #13–#20. Все команды выполнены на сервере `192.168.1.95`.

## Коммиты

| Коммит    | Находка      | Суть                                                                             |
| --------- | ------------ | -------------------------------------------------------------------------------- |
| `b81312c` | T13-A        | register: P2002 → 409 CONFLICT                                                   |
| `9255147` | T14-A        | миграция mc086 (UNIQUE на Preference) + транзакционный addPreference             |
| `731eb99` | T15-A, T20-B | IdempotencyReplayInterceptor: Redis, TTL 24ч, fingerprint, 409 IDEMPOTENT_REPLAY |
| `8e3e782` | T20-A, T20-C | generatePrepSession в Serializable-транзакции + retry P2034                      |
| `ee4cedb` | T18-A        | exception filter: одна запись лога, без Prisma meta dump                         |
| `39ef344` | T19-A, T19-B | AuthGuard по серверной сессии; middleware гейтит все app-экраны                  |
| `75428ae` | T15-B        | PATCH архивного pantry item → 409 PANTRY_ITEM_ARCHIVED                           |
| `6f0ebb6` | harness      | интеграционные тесты снова запускаемы в этом воркспейсе                          |
| `cf00bc4` | T17-A        | `@@index([tags], type: Gin)` в schema + README «DB-only invariants»              |
| `95a0198` | T18-B        | удалены 3 мёртвых Logger                                                         |
| `830ce5b` | T19-F        | синхронизированы pantry-комментарии (soft delete)                                |
| `6673606` | follow-up    | quote-stripped P2002 target matching (см. ниже)                                  |

## Прод-смоук после рестарта (реальный runtime)

| Сценарий                                  | Ожидание                                      | Факт                                        |
| ----------------------------------------- | --------------------------------------------- | ------------------------------------------- |
| `GET /health/ready`                       | 200                                           | **200**                                     |
| register: 1-й вызов с ключом K            | 201                                           | **201**                                     |
| register: replay того же K + того же тела | 201 + тот же sessionToken (T15-A)             | **201, same_token=true, cookie re-applied** |
| register: тот же email, новый ключ        | 409 CONFLICT (T13-A)                          | **409**                                     |
| register: 8 конкурентных, тот же email    | 1×201 + 7×409, 1 юзер в БД (T13-A)            | **1×201 + 7×409, users=1**                  |
| preferences: 10 конкурентных POST         | 10×2xx, 1 строка (T14-A)                      | **10×201, distinct_ids=1, rows=1**          |
| prep: 10 конкурентных POST                | 10×200, 1 сессия, задачи без дублей (T20-A/C) | **10×200, sessions=1, tasks=4**             |
| pantry: DELETE → PATCH архивного          | 409 PANTRY_ITEM_ARCHIVED (T15-B)              | **409 + правильное тело**                   |
| pantry: restore → PATCH после restore     | 200                                           | **200**                                     |
| web: next build, middleware bundle        | сборка без ошибок (T19-B)                     | OK                                          |

Схема-доказательства T14-A: `Preference_userId_kind_ingredientId_key` в `pg_indexes`; T17-A: `prisma migrate diff` (DB → schema) показывает только 3 pg_trgm GIN, задокументированные в README.

## Найдено и закрыто в ходе верификации (важно)

**`6673606` — закавыченные `meta.target`.** Прод-смоук поймал то, что пропустили 126 юнит- и 69 интеграционных тестов: Prisma отдаёт P2002 target с закавыченными идентификаторами колонок — `meta.target = ['"userId"', 'kind', '"ingredientId"']`. Проверки вида `Array.includes('ingredientId')` не совпадали, поэтому маппинг 409 в `addPreference` оставался мёртвым кодом: под реальной конкуренцией фиксы T14-A давали `1×201 + 9×500` (данные констрейнтом спасены, но клиент видел 500). Тот же дефект был в register-ветке T13-A (секвентные проверки её не касаются — они падают в pre-check). Фикс: общий хелпер `isUniqueConstraintOn(err, field)` со сравнением quote-stripped значений; юнит-тесты фиксируют реальную prod-форму meta. **Урок: конкурентные смоуки должны идти против живого runtime, не только против тест-скаффолда.**

## Хвосты (осознанно не закрыто)

| Пункт                               | Статус                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T17-B (pgvector)                    | расширение **оставлено** (решение по умолчанию); README дополнен caveat'ом про superuser. Смена решения = `DROP EXTENSION` через `sudo -u postgres` + `migrate resolve` |
| T16-A (raw null envelope)           | P3; требует выбора контракта (404 vs `{data:null}`) и синхронной правки web-клиентов                                                                                    |
| T18-C, T18-D                        | закрываются соседними коммитами этой сессии (health env + redactSecrets в логах)                                                                                        |
| T16-B (транзиентный onboarding 500) | план — retry по образцу prep-фикса; кандидат в блок 2                                                                                                                   |
| Тест-юзеры аудитов `@t.ru` в проде  | оставлены (не из этой сессии); удаляются тем же FK-порядком при необходимости                                                                                           |

## Инфраструктурные изменения за пределами репо

- Создана БД **`multichef_test`** (owner `multichef`, расширения предустановлены суперпользователем) — интеграционная suite гоняется только против неё.
- Миграция `20260914_mc086_preference_unique` применена к прод-БД (`prisma migrate deploy`).
- Патч harness'а (`pnpm --filter @multichef/database exec prisma migrate deploy`) закоммичен — `RUN_DB_INTEGRATION=1` больше не падает в setup.
