# ADR-0021: PantryItem — добавить `archivedAt` и `notes`

## Статус

Принято. Реализуется в MC-022 fix-forward.

## Контекст

В MC-022 (Pantry CRUD) при реализации обнаружено расхождение между task spec и `schema.prisma`:

| Поле                 | Spec (что писалось в задаче)                         | Schema (что в main после MC-003)           |
| -------------------- | ---------------------------------------------------- | ------------------------------------------ |
| Soft-delete          | `archivedAt DateTime?` (DELETE → archivedAt = now()) | **отсутствует** — DELETE удаляет физически |
| Заметки пользователя | `notes String?`                                      | **отсутствует**                            |
| Время создания       | `addedAt`                                            | `createdAt` (имя колонки)                  |

Бэкенд-бот в первом проходе реализовал **Вариант A** (honor schema, hard delete, без `notes`, sort по `createdAt`), чтобы не блокировать MC-022. Это было правильное тактическое решение, но оставляет три проблемы:

1. **`restore` endpoint всегда возвращает 400** — это API-контрактная «мина»: frontend-разработчик увидит restore в OpenAPI, начнёт использовать, получит 400.
2. **Невозможны заметки пользователя** — типичный user-demand для pantry («купил на рынке, до вторника»).
3. **Sort `addedAt` → `createdAt`** — это не schema issue, а ошибка в task spec (терминология). Schema правильна.

## Решение

**Добавить в `PantryItem` две nullable-колонки в одной миграции:**

```prisma
model PantryItem {
  // ... existing fields ...

  archivedAt  DateTime? @db.Timestamptz(6)  // NEW: soft-delete tombstone
  notes       String?                       // NEW: user notes (≤ 500 chars enforced in DTO)
}
```

### Почему обе колонки в одной миграции

- Разница в стоимости (одна колонка vs две) — **5 минут** SQL.
- Возврат позже за `notes` = отдельный ADR-фрагмент + отдельная миграция + отдельный ревью + отдельный deploy.
- `notes` — не гипотеза, это **типичный pantry user-demand**.

### Почему nullable, не required

- **Backward-compat**: существующие 0 строк в БД (Phase 2 стартует на новой schema), но nullable = не ломаем будущие read-paths которые ещё не знают о новом поле.
- **Soft-delete**: `archivedAt IS NULL` = active, `archivedAt IS NOT NULL` = archived.
- **Notes**: опциональны по дизайну (пользователь может не оставить заметку).

### Про `addedAt` → `createdAt`

Schema правильна (`createdAt` — стандарт Prisma convention). Task spec ошибся терминологией. **Ничего не мигрируем**, фиксим task spec и frontend использует `?sort=createdAt`.

## Изменения в MC-022 (fix-forward)

1. **Migration `20260909_add_pantryitem_archived_notes`**:

   ```sql
   ALTER TABLE "PantryItem" ADD COLUMN "archivedAt" TIMESTAMPTZ(6);
   ALTER TABLE "PantryItem" ADD COLUMN "notes" TEXT;
   CREATE INDEX "PantryItem_householdId_archivedAt_idx"
     ON "PantryItem" ("householdId", "archivedAt");
   ```

2. **DTO**:
   - `notes String?` (max 500 chars)
   - `?includeArchived=true` теперь имеет смысл — фильтр `where: { OR: [{archivedAt: null}, ...] }`
   - sort enum остаётся `createdAt|expiresAt|quantityG` (без `addedAt`)

3. **Service**:
   - `deleteItem()` → `update({ where: { id, householdId }, data: { archivedAt: new Date() } })`
   - `restoreItem()` → `update({ where: { id, householdId }, data: { archivedAt: null } })`, проверка `ITEM_NOT_ARCHIVED` если уже `archivedAt IS NULL`
   - `listItems()` — добавить `where: { archivedAt: includeArchived ? undefined : null }`

4. **Tests**:
   - Удалить тест "POST /:id/restore → always 400"
   - Добавить тесты: soft-delete + restore (round-trip), `includeArchived=true` фильтр, `notes` create/patch roundtrip
   - Integration test: archived item не виден в list без includeArchived

## Альтернативы (отвергнутые)

- **A. Принять как есть (hard delete, без notes)** — restore endpoint всегда 400 = мина в API. ❌
- **C. Только `archivedAt`, без `notes`** — экономит 5 минут сейчас, гарантирует вторую миграцию через N недель. ❌
- **D. Сделать `notes` отдельной таблицей `PantryItemNote`** — over-engineering для одного поля ≤ 500 chars. ❌

## Обратимость

**Средняя.** Удалить nullable-колонку можно через `ALTER TABLE DROP COLUMN` (zero data loss если поле пустое). Индекс нужно удалить вместе с колонкой. Soft-delete семантику изменить нельзя без data migration (active → archived migration), но это не наш случай.

## Стоимость

- ADR: 15 мин (этот документ).
- Миграция: 20 мин.
- Fix-forward в MC-022: 40 мин (DTO + service + 4 новых теста + update integration tests).
- Verification (боotsmoke, lint, typecheck, build): 15 мин.
- **Total: ~1.5 ч сверх варианта A.**

## Red flags

- Миграция обратима, но применяется на **пустой БД** (Phase 2 стартует). Если прод уже работает — нужна data migration strategy (out of scope).
- `notes` max 500 chars — не обсуждалось в PRD. Если позже понадобится больше — отдельная миграция с `@db.Text` (Postgres TEXT без лимита).
- Индекс `(householdId, archivedAt)` — составной, помогает частому query "active items моего household". Если появится другой частый паттерн (например, `expiresAt < now()`) — добавим отдельный индекс в ADR-продолжении.

## Следующие шаги

1. **Менеджер**: отправить бэкенд-боту fix-forward карточку для MC-022.
2. **Бэкенд-бот**: миграция + DTO + service + тесты + commit.
3. **Менеджер**: верифицировать, открыть PR, merge.
4. **Никаких новых ADR** для `notes`/`archivedAt` — закрыто этим документом.
