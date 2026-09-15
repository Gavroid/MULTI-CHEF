# API Conventions — формат ошибок, пагинация, идемпотентность

> Этот документ фиксирует контракт HTTP API для `apps/api` (NestJS + Fastify, порт 3001, префикс `/api/v1`).
> Написан по итогам MC-004 Фазы 0 (ADR-0007) на основе PRD §4.1.
> Обязателен к прочтению перед началом любой backend-задачи (MC-010 и далее).

---

## 1. Формат ошибок

**Все ошибки** (любой HTTP status 4xx/5xx) возвращаются в едином формате:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": {
      "field": "email",
      "reason": "must be a valid email"
    }
  }
}
```

Поля:

| Поле            | Тип            | Обязательно | Описание                                                   |
| --------------- | -------------- | ----------- | ---------------------------------------------------------- |
| `error.code`    | string (enum)  | да          | Машино-читаемый код (см. таблицу ниже)                     |
| `error.message` | string         | да          | Человеко-читаемое описание, без PII                        |
| `error.details` | object \| null | нет         | Дополнительный контекст (поле, причина, стек только в dev) |

Никаких дополнительных полей на верхнем уровне — все под `error`.

### Коды ошибок

| HTTP | code                   | Когда                                                                                                                                                    |
| ---- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`     | DTO не прошёл Zod/class-validator                                                                                                                        |
| 400  | `BAD_REQUEST`          | Синтаксическая ошибка в запросе                                                                                                                          |
| 401  | `UNAUTHORIZED`         | Нет сессии или токен невалиден                                                                                                                           |
| 403  | `FORBIDDEN`            | Сессия есть, но нет прав на ресурс                                                                                                                       |
| 404  | `NOT_FOUND`            | Ресурс не найден **или** не принадлежит householdId из сессии (PM-prompt #3: 404 вместо 403, чтобы не утекала информация о существовании чужих ресурсов) |
| 409  | `CONFLICT`             | Уникальность нарушена, ресурс уже существует                                                                                                             |
| 409  | `IDEMPOTENT_REPLAY`    | Idempotency-Key уже использован с другим телом запроса                                                                                                   |
| 409  | `PANTRY_ITEM_ARCHIVED` | Ресурс в архиве (soft-delete): сначала `POST /pantry/items/:id/restore`, затем PATCH                                                                     |
| 429  | `RATE_LIMITED`         | Превышен rate limit (см. env-coverage RATE_LIMIT_*)                                                                                                      |
| 500  | `INTERNAL_ERROR`       | Непредвиденная ошибка сервера                                                                                                                            |
| 503  | `SERVICE_UNAVAILABLE`  | БД / Redis / внешний сервис недоступен                                                                                                                   |

**T38-A (v2-реестр).** Полный машиночитаемый источник — `apps/api/src/common/error-envelope.ts` (`ErrorCode` / `STATUS_BY_CODE`). Помимо таблицы выше в проде используются доменные коды (404/409/422): `INGREDIENT_NOT_FOUND`, `RECIPE_NOT_FOUND`, `MEAL_PLAN_NOT_FOUND`, `HOUSEHOLD_NOT_FOUND`, `USER_NOT_FOUND`, `SESSION_NOT_FOUND`, `PANTRY_ITEM_NOT_FOUND`, `PANTRY_ITEM_ARCHIVED`, `SHOPPING_LIST_NOT_FOUND`, `SHOPPING_ITEM_NOT_FOUND`, `JOB_NOT_FOUND`, `PLAN_NOT_FOUND`, `PREP_TASK_NOT_FOUND`, `EMPTY_RESCUE`, `ROULETTE_EMPTY`, `REJECT_LIMIT_REACHED`, `PREFERENCE_NOT_FOUND`, `NUTRITION_PROFILE_NOT_FOUND`, `ITEM_NOT_ARCHIVED`, `CSRF_MISMATCH`, `IDEMPOTENT_REPLAY`. Зарезервированы (заполняются по мере развития домена): `BAD_REQUEST`, `JOB_FAILED`, `MEAL_PLAN_NOT_FOUND*`, `HOUSEHOLD_NOT_FOUND*`, `USER_NOT_FOUND*`, `SESSION_NOT_FOUND*`, `PREFERENCE_NOT_FOUND*` (* — семантически покрыты доменными аналогами). CI-тест `error-codes.test.ts` следит за синхронностью enum и этой таблицы.

В development режиме (`NODE_ENV=development`) `error.details` может содержать `stack: string[]`. В production — **никогда**.

---

## 2. Пагинация

**Cursor-based** пагинация. Параметры:

| Параметр | Тип            | Default | Описание                                            |
| -------- | -------------- | ------- | --------------------------------------------------- |
| `cursor` | string \| null | null    | Курсор предыдущей страницы (`nextCursor` из ответа) |
| `limit`  | int            | 20      | Размер страницы. Max 100. Min 1.                    |

Формат ответа:

```json
{
  "data": [...],
  "nextCursor": "01HMZ8X9R6K7P3WXY5T2N0V4J8"
}
```

- `nextCursor: null` означает конец списка.
- Курсор **не** human-readable, **не** передавайте его между сессиями.
- Не используется `offset` / `page` / `total` — только cursor. Это упрощает работу с большими коллекциями и не ломается на вставках.
- `limit > 100` → `400 VALIDATION_ERROR` с `details.field="limit"`.

---

## 3. Идемпотентность

**Все мутации** (POST / PUT / PATCH / DELETE) **обязаны** принимать заголовок `Idempotency-Key`.

| Поле           | Значение                                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Заголовок      | `Idempotency-Key: <ULID or UUID v4>`                                                                                                                                         |
| Обязательность | для всех мутаций                                                                                                                                                             |
| TTL ключа      | 24 часа                                                                                                                                                                      |
| Поведение      | первый запрос с этим ключом выполняется; последующие с тем же ключом и тем же телом возвращают кешированный ответ; с тем же ключом но другим телом → `409 IDEMPOTENT_REPLAY` |

GET-запросы идемпотентны по определению и не требуют заголовка.

Если клиент не прислал `Idempotency-Key` на мутацию → `400 VALIDATION_ERROR` с `details.field="Idempotency-Key"`.

Пример:

```bash
curl -X POST http://localhost:3001/api/v1/meal-plans \
  -H "Authorization: Session ..." \
  -H "Idempotency-Key: 01HFAKEFAKEFAKEFAKEFAKEFAKE" \
  -H "Content-Type: application/json" \
  -d '{"startDate":"2026-09-15", ...}'
```

---

## 4. Timestamp

**Все timestamps** в API — ISO 8601 в UTC с суффиксом `Z`:

```
2026-09-08T11:30:45.123Z
```

- Без timezone offset (только `Z`).
- Milliseconds, минимум 3 цифры после точки.
- `Date` в Postgres → сериализуется в UTC всегда (Prisma делает это автоматически).
- Приём от клиента — допускается любой ISO 8601 валидный, но сервер нормализует к UTC.

Запрещено: Unix-таймстампы (`1715000000`), локальные форматы (`08.09.2026 11:30`), строки без timezone.

---

## 5. ID format

Все ID в API — **ULID** (Universally Unique Lexicographically Sortable Identifier), 26 символов, символы `[0-9A-HJKMNP-TV-Z]`.

Пример: `01HMZ8X9R6K7P3WXY5T2N0V4J8`

- Сортируются lexicographically по времени создания (первые 10 символов = timestamp).
- Не утекают внутренние счётчики (как auto-increment int).
- Кейс-чувствительные, но всегда uppercase.
- Реализация: `ulid` npm-пакет (MC-010).

Запрещено: UUID v4 (`550e8400-e29b-41d4-a716-446655440000`), int (`42`), string slug (`my-recipe`). Любое такое значение → `400 VALIDATION_ERROR`.

---

## 6. Money

**Все денежные суммы** в API — целые **копейки** (`Int` в Postgres, `number` в JSON), **НИКОГДА** float.

Пример:

```json
{
  "estimatedTotalKopecks": 65000,
  "budgetLimitKopecks": 58000
}
```

- Сериализация: `number` в JSON, но сервер гарантирует что число целое и помещается в `Int` (макс ~21M ₽).
- Конвертация в рубли — на фронте (`estimatedTotalKopecks / 100`).
- Никаких `"6,500.00"`, `"6500.00"`, `6500.0`, `6500` без указания.
- Если пришёл float → `400 VALIDATION_ERROR` с `details.field="..."`.

PM-prompt #5: **Денежные суммы — целые копейки (Int), никогда float**. Питательные значения — Decimal. Этот раздел — про деньги, не про нутриенты.

---

## 7. Что НЕ покрыто этим документом

- **Конкретные эндпоинты** — см. PRD §4 (Auth, Ingredients, Pantry, Recipes, MealPlans, Shopping, Prep, Jobs) и OpenAPI в `/api/v1/docs` (после MC-010).
- **Версионирование API** — `/api/v1` фиксируется до v1.0.0; breaking changes = новый префикс `/api/v2` + одновременная поддержка в течение 6 месяцев (post-MVP).
- **Rate limiting конкретных endpoint'ов** — настраивается через `RATE_LIMIT_*` env, см. `.env.example`.
- **Кеширование ответов** — Cache-Control headers по конкретным ресурсам — отдельный ADR в Фазе 7.
