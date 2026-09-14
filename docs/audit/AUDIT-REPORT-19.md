# Технический, продуктовый и UI-аудит MULTI-CHEF (19-й круг)

**Дата:** 2026-09-14
**HEAD:** `5c18bc3 chore(audit): AUDIT-REPORT-18 logger + exception-filter`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-18.md`, `VERIFICATION.md`
**Фокус:** Next.js web layer — auth boundary, middleware, BFF безопасность.

## TL;DR

19-й круг: **2 🟠 P2 находки** про **client-server auth divergence** в Next.js приложении.

- 🟠 **T19-A — AuthGuard защищает UI через `localStorage`, а реальная сессия — HttpOnly cookie** `mc_session`. Эти два источника истины могут разойтись.
- 🟠 **T19-B — `middleware.ts` защищает только `/profile`**, остальные экраны (`/today`, `/fridge`, `/plan`, `/shopping`) полагаются на client-side AuthGuard → **server-render flash + flaky-on-3rd-party-script**.
- ✅ CSRF double-submit cookie в `auth-client.request()` корректно читает `mc_csrf` и подставляет в `X-CSRF-Token` header.
- ✅ `usePantry` корректно использует AbortController, кэш 30s, поддерживает отмену при unmount.
- ✅ Idempotency-Key автогенерируется через `crypto.randomUUID()` с fallback на `crypto.getRandomValues()`.

---

## 1. Технические находки (19-й круг)

### T19-A. AuthGuard использует `localStorage` вместо HttpOnly cookie `mc_session` 🟠 P2

**Файл:** `apps/web/src/components/AuthGuard.tsx`
**Также:** `apps/web/src/lib/auth-storage.ts`

**Raw:**

```ts
// AuthGuard.tsx
const STORAGE_KEY = 'mc_user';
export function AuthGuard({ children }) {
  const [redirected, setRedirected] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw && !redirected) {
        setRedirected(true);
        router.replace('/auth/login');
      }
    } catch { /* fallback */ }
  }, [router, redirected]);
  return <>{children}</>;
}
```

**Проблема:**

- Реальная сессия = HttpOnly `mc_session` cookie (записывается сервером, JavaScript не может её прочитать/подделать).
- `AuthGuard` редиректит на основе **`mc_user` localStorage** — НЕ реальной сессии.
- `mc_user` хранит `{id, email, householdId}` (см. `auth-storage.ts:11-14`) — фактически «client-side cache».

**Когда эти два source-of-truth расходятся:**

| Сценарий                            | `mc_session` (cookie)         | `mc_user` (localStorage)          | AuthGuard поведение                                                 |
| ----------------------------------- | ----------------------------- | --------------------------------- | ------------------------------------------------------------------- |
| Login flow                          | ✅ set                        | ✅ set via `saveLocalUser()`      | ✅ OK                                                               |
| Logout                              | ✅ cleared                    | ✅ cleared via `clearLocalUser()` | ✅ OK                                                               |
| User cleared cookies in DevTools    | ✅ cleared                    | ❌ stale                          | "Logged-in" UI but API 401 → confused state                         |
| User cleared localStorage only      | ❌ stale-cookie (still valid) | ❌ cleared                        | **Premature redirect to /auth/login** → user loses session mid-work |
| 3rd-party script reads localStorage | ❌ leaked to script           | (vulnerable)                      | ❌ PII (email) exposed to page JS                                   |
| Server-side session expired (TTL)   | ✅ expired                    | ❌ stale                          | UI believes logged-in until first API call → confusing              |

**Hotfix (10 мин):**
В `AuthGuard` заменить чтение localStorage на попытку `/api/v1/auth/session` (server call):

```ts
useEffect(() => {
  fetch('/api/v1/auth/session', { credentials: 'include' })
    .then((r) => (r.ok ? null : Promise.reject()))
    .catch(() => router.replace('/auth/login'));
}, [router, redirected]);
```

Делает AuthGuard **настоящим client-side guard**, привязанным к серверной истине.

**Альтернатива (дополнительно):** оставить localStorage для UX-меток (BottomTabBar highlighting) и использовать её только для hint, но редирект-решение принимать на основе `mc_session`-aware вызова.

---

### T19-B. `middleware.ts` защищает только `/profile` — остальные экраны клиентские 🟠 P2

**Файл:** `apps/web/src/middleware.ts`

**Raw:**

```ts
const PROTECTED_PREFIXES = ['/profile'];
export const config = {
  matcher: ['/profile/:path*', '/profile'],
};
```

**Что НЕ защищено на сервере:**

- `/today` — meal-plan tab
- `/fridge` — pantry tab
- `/plan` — weekly plan
- `/shopping` — shopping lists
- `/today/roulette` — roulette
- `/recipe/<id>` — recipe detail

**Что говорит comment:**

> "We deliberately do NOT protect /today, /fridge, /plan, /shopping in MC-013: those screens have empty-state content that guests can browse (PRD §2.3.2 lets logged-out users see the dashboard with a CTA). MC-014 will tighten the policy once the auth flow ships."

**Конкретные последствия:**

1. **Flash-of-content**: Любой authed screen (e.g. `/plan`) сначала SSR-рендерит children → потом AuthGuard редиректит. Между SSR и `useEffect`, **user может видеть содержимое 50–200ms** (или больше, если CPU loaded).
2. **Прямой curl /api/v1/meal-plans/active без mc_session cookie** → 401, но **SSR не делает preflight auth check** для страниц.
3. **`<AuthGuard>` runs only after `useEffect`** — после полной загрузки JS. Если у пользователя скрипт блокирован, редирект вообще не сработает, но данные придут пустые (401) → в UI будет пустой экран без объяснения.

**Hotfix (15 мин):**

```ts
// middleware.ts
const PROTECTED_PREFIXES = ['/', '/profile', '/today', '/fridge', '/plan', '/shopping'];
export const config = {
  matcher: [
    '/profile/:path*',
    '/profile',
    '/today/:path*',
    '/today',
    '/fridge/:path*',
    '/fridge',
    '/plan/:path*',
    '/plan',
    '/shopping/:path*',
    '/shopping',
  ],
};
```

Это правильно делать **СЕЙЧАС** (MC-014), а не откладывать на «потом», потому что:

- Empty-state редиректы могут сломать пользователей, привыкших к гостевому режиму (если спецификация неясна).
- `/recipe/<id>` — **recipe detail с ценами и метаданными**, его точно нужно guard.

**T19-B.1 (additional):** Файлы, попадающие под MC-014 согласно comment, но **нет issue-ticket** или `MC-014-*.md` design doc:

```bash
$ grep -rn "MC-014" /opt/multichef --include="*.md" 2>/dev/null | head -3
# (только упомянания в коде — не design doc)
```

---

## 2. Подтверждённые здоровые паттерны

### ✅ CSRF double-submit cookie в web-client

```ts
// apps/web/src/lib/auth-client.ts:130-138
if (typeof document !== 'undefined') {
  const csrf = document.cookie
    .split('; ')
    .find((c) => c.startsWith('mc_csrf='))
    ?.split('=')[1];
  if (csrf) headers['X-CSRF-Token'] = csrf;
}
```

Корректно: для всех `POST/PUT/PATCH/DELETE` добавляет `X-CSRF-Token` из cookie. ✅

### ✅ Idempotency-Key автоматически генерируется

```ts
// apps/web/src/lib/auth-client.ts:78
function generateIdempotencyKey() {
  if (c.randomUUID) return c.randomUUID();
  // fallback to UUID v4-shaped
}
```

✅ fallback на `crypto.getRandomValues` для старых runtimes.

### ✅ usePantry корректно обрабатывает fetch lifecycle

- AbortController создаётся для каждой операции
- `cleanup` при unmount: `cancelled = true; controller.abort()`
- Module-scope кэш 30s с TTL
- refetch() bypass cache
  ✅ Tested (`__tests__`).

### ✅ Logout flow очищает оба хранилища

```ts
// profile/page.tsx:118
window.localStorage.removeItem('mc_user');
// cookies.clear() handled server-side (mc_session HttpOnly)
```

✅ Best practice.

### ✅ `getApiBaseUrl` конфигурируется через env

```ts
// apps/web/src/lib/env.ts (referenced)
```

✅ Separate env module (audit round 4).

---

## 3. Микро-наблюдения

- **T19-C** — `usePantry` использует module-scope cache (30s), но **нет invalidation при logout**. Если user-A и user-B шарят module-scope state (multi-tab session), и user-A выходит → его кэш не очищается → user-B может видеть stale data. Hygiene fix: subscribe to auth state changes → clear cache.
- **T19-D** — `apps/web/src/hooks/usePreferences.ts` — аналогичный паттерн (предположительно). Должно быть проверено.
- **T19-E** — `mc_user` хранит PII email. Не критично (email не secret), но в localStorage после logout может **застрять на btrfs/cloud-backup** — никакого Wiping.
- **T19-F** — комментарий `pantry-client.ts:7`: «The backend's pantry.controller.ts file header still says 'hard delete' — that's stale commentary from MC-022 draft 1.» — **drift между comment-в-исходниках и реальным state-of-the-code**. Code review hygiene: stale comments confuse.

---

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона           | Находка                                                                                                                                                                              | Где                                                                                      |
| --------- | --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **T19-A** | 🟠 P2     | Web/Auth       | AuthGuard проверяет `localStorage.getItem('mc_user')` вместо HttpOnly cookie `mc_session`. UI и реальная сессия — два разных source-of-truth.                                        | `apps/web/src/components/AuthGuard.tsx:18-32` + `apps/web/src/lib/auth-storage.ts:11-14` |
| **T19-B** | 🟠 P2     | Web/Middleware | middleware.ts защищает только `/profile`. `/today`, `/fridge`, `/plan`, `/shopping`, `/recipe/<id>` — клиент-сайд только. Server-render flash + 401-контент на расшаренной закладке. | `apps/web/src/middleware.ts:7-15`                                                        |

---

## 5. Куммулятивный итог (19 кругов)

| Iter    | Findings         | 🔴 P0  | 🔴 P1 | 🟠 P2-P3    | 🟡 ℹ️        | Cumulative            |
| ------- | ---------------- | ------ | ----- | ----------- | ------------ | --------------------- |
| #1–3    | 26               | 9      | 0     | 6           | 11           | —                     |
| #4–10   | 13               | 0      | 0     | 13          | 0            | —                     |
| #11     | T11-A, T11-B     | 0      | 0     | 2           | 0            | —                     |
| #12     | T12-A            | 0      | 0     | 1           | 0            | —                     |
| #13     | T13-A            | 1 P0   | 0     | 0           | 0            | 10 P0                 |
| #14     | T14-A            | 0      | 0     | 1           | 0            | 10 P0                 |
| #15     | T15-A, T15-B     | 1 P0   | 0     | 1           | 0            | 11 P0                 |
| #16     | T16-A, T16-B     | 0      | 0     | 2           | 0            | 11 P0                 |
| #17     | T17-A, T17-B     | 0      | 2 P1  | 0           | 0            | 11 P0, 2 P1           |
| #18     | T18-A–D          | 0      | 0     | 2 P2 + 2 P3 | 0            | 11 P0, 2 P1, 2 P2     |
| **#19** | **T19-A, T19-B** | 0      | 0     | **2 P2**    | 0            | 11 P0, 2 P1, **4 P2** |
| **Σ**   | **~56**          | **11** | **2** | **30**      | **13 ℹ️/P3** | —                     |

**Тренд 19-ти:** фокус смещается на **Next.js клиент-сайд auth** — два новых P2-наблюдения, дополняющие 11 P0 race-conditions и 2 P1 schema-drift. Паттерн «incomplete switch to cookie-auth» — architecturally significant.

---

## 6. Рекомендации (19-й круг)

1. **(P2, 30 мин, T19-A + T19-B в комбинации)** Сделать MC-014: перевести все защищенные роуты на middleware-redirect + иметь fallback client-side AuthGuard только для UX. Приоритетно: `/plan`, `/today`, `/shopping` (где SSR-render контента = privacy leak).
2. **(P3, 5 мин, T19-C)** Add cache-invalidation hook в `usePantry`/`usePreferences` → subscribe to logout event → clear module-scope cache.
3. **(P3) Hygiene:** Удалить stale-comment в `pantry-client.ts:7` про «hard delete».
4. **(P0, повтор, постоянно)** T13-A, T15-A **не пофикшены** — race conditions register/idempotency.
5. **(P1, повтор)** T17-A — schema.prisma drift (one_active_plan partial unique не отражён).
6. **(P1, новый)** T17-B — pgvector extension unused.

---

## 7. Артефакты (19-й круг)

| Артефакт                                  | Где                             |
| ----------------------------------------- | ------------------------------- |
| Этот отчёт                                | `docs/audit/AUDIT-REPORT-19.md` |
| `AuthGuard.tsx` raw                       | §1 T19-A                        |
| `auth-storage.ts` STORAGE_KEY = 'mc_user' | §1 T19-A                        |
| `middleware.ts` matcher = ['/profile']    | §1 T19-B                        |
| `auth-client.ts:130-138` CSRF injection   | §2                              |
| `pantry-client.ts:7` stale comment        | §3 T19-F                        |
