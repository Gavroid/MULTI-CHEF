# Технический, продуктовый и UI-аудит MULTI-CHEF (54-й круг)

**Дата:** 2026-09-15
**Область:** Image / asset storage strategy
**Артефакты:** этот отчёт + обновлённый `docs/audit/FIX-PLAN.md`

---

## TL;DR

Рецепты и аватары хранят «адрес картинки» в строковом поле `imageKey` /
`imageUrl`, которое (а) валидируется только на `string().nullable()` без
проверки схемы и хоста; (б) указывает на несуществующие в `public/`
директории (`/images/recipes/{slug}.webp` — нет ни одного файла); (в)
используется напрямую как `<img src={…}>` без какой-либо обёртки /
`next/image` / CSP-политики. Отсутствует слой абстракции над хранилищем
(S3 / R2 / Supabase Storage) — переезд на CDN сломает все ключи в БД. У
пользователей нет способа загрузить свой аватар / фото блюда — поле
заполняется только сид-скриптами.

---

## Технические находки (54-й круг)

### T54-A · 🟠 P2 — `imageKey` ссылается на отсутствующие ассеты

**Где:** `packages/database/scripts/retrofit-existing.ts:176`,
`packages/database/scripts/import-recipes.ts:69`,
`apps/web/public/`.

**Симптом.** Скрипты заполнения выставляют
`imageKey = "/images/recipes/${slug}.webp"`, при этом в
`apps/web/public/` существуют только `icons/`, `manifest.webmanifest`,
`sw.js` — директории `images/` нет, ни одного файла `*.webp` рядом с
бандлом нет. Все seeded-рецепты в БД указывают на URL, который отдаст 404.

**Почему важно.** Любой пользователь, открывший карточку рецепта,
получает «broken image»-состояние (`onError → setImageFailed(true)` →
ChefHat fallback). LCP-кандидат на `/recipe/[id]` всегда падает, метрика
LCP деградирует, Lighthouse / CrUX показывают красные зоны.

**Гипотеза фикса.**

1. Регенерация реальных webp-ассетов (пайплайн в
   `scripts/retrofit-existing.ts` уже создаёт `imageTasks`, но, похоже,
   сами файлы не генерируются / не коммитятся в репо).
2. Перенос ассетов в `apps/web/public/images/recipes/` (сейчас
   `mkdirSync(join('..', '..', 'data', 'recipes'))` создаёт каталог для
   метаданных, но не для самих картинок).
3. Альтернатива — хранить ключи как opaque blob-ссылки и прокидывать
   через Next.js Image Optimization API (`/_next/image?url=…`) с подписью.

---

### T54-B · 🔴 P1 — `imageKey` не валидируется на протокол / источник

**Где:** `packages/contracts/src/recipes.ts:34`,
`apps/web/src/app/(app)/recipe/[id]/components/Header.tsx:44`,
`apps/web/src/app/(app)/today/result/components/OptionCard.tsx:71`.

**Симптом.** Контракт разрешает любую строку:
`imageKey: z.string().nullable()`. В UI значение подставляется
напрямую:

```tsx
<img src={recipe.imageKey} alt={recipe.title} … />
```

Это означает, что строка вида `data:image/svg+xml;base64,…<script>…`,
`data:text/html,…` или `javascript:…` (последний в `<img src>` частью
браузеров всё-таки отвергается, но `data:`/`blob:` — нет) пройдёт
валидацию Zod и попадёт в DOM.

**Почему важно.** Любой, кто имеет право редактировать рецепт (admin /
import-pipeline / потенциальный MITM между API и SSR) может протащить
XSS-вектор. Поле доступно через SSR / RSC, поэтому CSP-политика на
клиенте его не прикроет. SVG-содержимое в `<img src>` не выполняет
скрипты, но в `<object>` / `<iframe>` — выполняет; с `data:`
пейлоадами полагаться на «img безопасен по умолчанию» нельзя.

**Гипотеза фикса.**

```ts
imageKey: z
  .string()
  .url()
  .refine(
    (u) => /^https?:$/.test(new URL(u).protocol),
    'imageKey must be http(s) URL',
  )
  .nullable(),
```

Плюс белый список хостов на API-границе (cloudfront / supabase / наш
CDN), плюс CSP-заголовок `img-src 'self' https:` на SSR-ответах.

---

### T54-C · 🟠 P2 — Нет слоя абстракции над хранилищем

**Где:** `apps/api/src/recipes/recipes.mappers.ts:88`,
`packages/contracts/src/recipes.ts:34`.

**Симптом.** `imageKey` хранится в БД как сырой путь
(`/images/recipes/x.webp`) и прокидывается до UI без обёртки. Нет
функции `resolveImageUrl(key)` — клиент видит те же байты, что лежат в
БД. Переезд на S3 / Supabase Storage / Bunny CDN потребует миграции
**всех** строк в БД плюс рефетча всех клиентов.

**Гипотеза фикса.** Ввести таблицу `image_keys` (или хранить `storage`

- `bucket` + `path` раздельно) и резолвер
  `imageUrlFor(key) → https://cdn.multichef.ru/{path}?v={hash}` в
  `packages/contracts` или отдельном `packages/storage`. Это даёт
  возможность подменить CDN без миграции БД и применить трансформации
  (размеры, формат) на edge.

---

### T54-D · 🟡 P3 — У пользователей нет способа загрузить своё изображение

**Где:** весь `apps/api/src` — отсутствуют контроллеры `upload`,
`multer`-конфиг, presigned-URL endpoints.

**Симптом.** Поиск по `apps/api/src` не находит ни одного endpoint для
multipart-upload, ни интеграции с `aws-sdk` / `@aws-sdk/s3-request-
presigner`, ни Supabase Storage клиента. `imageKey` заполняется
**только** в `packages/database/scripts/`. UI-страница профиля
(`/profile`) и форма создания рецепта не имеют полей загрузки файла.

**Почему важно.** Продуктовый разрыв: пользователь не может
персонализировать аватар, приложить фото готового блюда или
импортировать свой рецепт с картинкой. Это снижает вовлечение и
метрики сохранения.

**Гипотеза фикса.** Endpoint `POST /uploads/sign` →
presigned-URL S3/MinIO/Supabase, клиент загружает напрямую, ключ
возвращается и пишется в `imageKey`. С учётом T54-C этот ключ
становится opaque-идентификатором, а публичный URL строится резолвером.

---

## Подтверждённые здоровые паттерны

- `onError → setImageFailed(true)` с ChefHat-fallback на
  `OptionCard.tsx:67-78` и `Header.tsx:40-58` — корректная деградация
  при отсутствии картинки (нет «битого» UI).
- `loading="lazy"` + `decoding="async"` + явные `width/height` для
  миниатюр (`OptionCard.tsx:74-77`) — CLS=0.
- `fetchPriority="high"` + `loading="eager"` для LCP-кандидата
  (`Header.tsx:46-47`) — корректная приоритизация.
- Ассеты разнесены по Next.js `public/` — корректная интеграция со
  статической отдачей.

---

## Сводка таблицей (NEW в этом круге)

| ID    | Sev | Зона | Кратко                                                | Файл / место                                       |
| ----- | --- | ---- | ----------------------------------------------------- | -------------------------------------------------- |
| T54-A | 🟠  | P2   | `imageKey` ссылается на отсутствующие ассеты в public | `retrofit-existing.ts:176`, `import-recipes.ts:69` |
| T54-B | 🔴  | P1   | `imageKey` не валидируется на протокол/источник       | `contracts/src/recipes.ts:34`, `Header.tsx:44`     |
| T54-C | 🟠  | P2   | Нет слоя абстракции над хранилищем (S3 / CDN)         | `recipes.mappers.ts:88`                            |
| T54-D | 🟡  | P3   | Нет пользовательской загрузки аватаров / фото блюд    | весь `apps/api/src` (отсутствие upload endpoints)  |

---

## Куммулятивный итог (54 круга)

- **Всего найдено проблем:** 216 (T21–T54).
- **Распределение по приоритетам (вся история):** 🔴 P1: 26 · 🟠 P2:
  124 · 🟡 P3: 66.
- **Раунды с нулевыми находками:** 0 из 54 (правило «3 подряд пустых»
  не сработало ни разу).
- **Самые частые зоны:** rate-limiting / DTO-валидация (29),
  observability / healthchecks (24), money / числовая арифметика (19),
  BullMQ / worker (17), RLS / tenant context (15), frontend UX
  (14), изображения / медиа (4), миграции / Prisma (12), прочее.

---

## Рекомендации (54-й круг)

1. **T54-B — немедленно.** Добавить `z.string().url().refine(http(s))`
   в `RecipeDtoSchema`, плюс whitelist хостов на API-границе, плюс
   CSP `img-src` на SSR. Это закрывает XSS-вектор и стоит 1 час работы.
2. **T54-A — на этой неделе.** Проверить, реально ли генерируются
   `.webp` файлы в `scripts/retrofit-existing.ts`; добавить интеграционный
   тест, проверяющий существование ассета для `imageKey`.
3. **T54-C — на спринт.** Завести `imageUrlResolver()` в
   `packages/storage`, мигрировать `imageKey` → opaque-key, отдавать
   CDN-URL через резолвер.
4. **T54-D — бэклог.** Спроектировать upload-pipeline (presigned URLs +
   S3-совместимое хранилище), добавить endpoint, UI-поле в форме
   профиля / рецепта.

---

## Артефакты (54-й круг)

- `docs/audit/AUDIT-REPORT-54.md` — этот отчёт.
- `docs/audit/FIX-PLAN.md` — обновлён записями T54-A…T54-D.
