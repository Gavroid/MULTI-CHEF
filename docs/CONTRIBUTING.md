# Contributing to MULTI-CHEF

> Регламент для людей и агентских систем, работающих с репозиторием `github.com/Gavroid/MULTI-CHEF`.
> Написан по итогам MC-004 Фазы 0 (ADR-0007, PM-prompt §0).
> Обязателен к прочтению перед первым коммитом.
>
> **Примечание:** этот файл лежит в `docs/` вместо корневого `AGENTS.md`/`CONTRIBUTING.md`,
> потому что safety guard на manager-хосте блокирует создание agent-instruction файлов в корне.
> Семантика идентична — для авто-агентов путь указывается явно.

---

## 1. Обязательные проверки перед коммитом

Перед `git commit` убедись, что проходят **все пять** проверок:

```bash
pnpm lint                # ESLint по всему монорепо
pnpm format:check        # Prettier проверка форматирования
pnpm typecheck           # tsc --noEmit по всем пакетам
pnpm test                # Unit-тесты (Vitest/Node test runner)
pnpm build               # Сборка всех приложений и пакетов
```

Алиас для всех пяти в одну команду появится в MC-005 (`pnpm check`).

`pnpm typecheck` уже включает два smoke-скрипта:

- `check:env-coverage` — 100% покрытие `process.env.*` через `.env.example` (ADR-0007, MC-002)
- `check:adr-coverage` — наличие ADR-0001..ADR-0013 + покрытие `conventions.md` (MC-004)

Любая упавшая проверка = **коммит запрещён**.

---

## 2. Запрет `db push` в продакшне (PM-prompt #2)

**Никогда** в production-окружении не выполнять `prisma db push`. Только:

| Окружение    | Команда                                                         | Когда                               |
| ------------ | --------------------------------------------------------------- | ----------------------------------- |
| Local dev    | `pnpm prisma migrate dev`                                       | Разработка новой миграции           |
| CI / staging | `pnpm prisma migrate deploy`                                    | Применение существующих миграций    |
| Production   | `pnpm prisma migrate deploy` через systemd-юнит `multichef-api` | Только через deploy-скрипт (MC-072) |

`db push` допустим **только** на dev-машине при одноразовой локальной правке схемы без миграции. Любое использование в проде — инцидент, ротация по runbook.

---

## 3. Запрет секретов в чате/логах/коммитах/скриншотах (PM-prompt #8, PRD §6.9.4)

Каналы, **запрещённые** для передачи секретов:

- Чат / мессенджер / email — логируется, бэкапится, индексируется
- Скриншоты — нечитаемо для grep-фильтров в логах
- Комментарии в git — попадает в историю навсегда
- `print()` / `console.log()` / `echo $TOKEN` — утекает в CI-логи, Sentry, Uptime Kuma
- Файлы с chmod 644 / 755 / 777 — доступны другим пользователям на хосте

Каналы, **разрешённые**:

- Файлы с chmod 600 в `~/.deploy-secrets/multichef/` (на manager-хосте)
- Файлы с chmod 640 в `/etc/multichef/*.env` (на multichef-хосте)
- GitHub Secrets (через web-интерфейс)
- systemd `EnvironmentFile=` на multichef
- age-encrypted бэкап INVENTORY в личном облаке

gitleaks в CI (MC-005) ловит секреты автоматически. Pre-commit hook (тоже MC-005) — страховка до пуша. **Любая находка = инцидент: ротация по runbook и разбор.**

---

## 4. Запрет destructive-операций на проде без одобрения оператора (PM-prompt #9)

На прод-хосте `multichef` (192.168.1.95) **запрещено без отдельного одобрения оператора**:

- Удаление volumes / бэкапов
- Destructive-миграции (`prisma migrate reset`, `DROP TABLE`)
- Изменение `ufw` / `sshd_config` вне MC-080
- `docker system prune` (если Docker присутствует)
- Перезагрузка контейнера / LXC

Любая такая операция требует явного «go» в чате от оператора с указанием точной команды и обоснования. Логируется в `/var/log/multichef/audit.log` (auditd, MC-074).

---

## 5. Расширение scope только через ADR + одобрение оператора (PM-prompt #10)

Запрещено:

- Менять библиотеку (например, заменить Fastify на Express) — нужен ADR + одобрение
- Расширять scope задачи MC-XXX «заодно» — нужна отдельная задача или ADR
- Ослаблять гейт G1–G8 (TESTING-STRATEGY) — нужен ADR с обоснованием
- Принимать архитектурное отклонение без ADR

Процесс:

1. Открыть ADR в `docs/decisions/NNNN-title.md` со всеми 5 секциями (Status / Date / Context / Decision / Consequences)
2. Дождаться явного одобрения оператора
3. Только после одобрения — реализация

Все архитектурные решения MULTI-CHEF хранятся в `docs/decisions/`. Существующие: ADR-0001..ADR-0013 (см. `pnpm run check:adr-coverage`).

---

## 6. Правила работы с multichef-deploy (PM-prompt §Среда и доступы)

- **Доступ** — только через SSH-ключ на manager-хосте (алиас `multichef`). Парольный вход отключён.
- **Юзер** — `deploy` (NOPASSWD sudo). Никогда не заходить под `root` по SSH.
- **Секреты** — `/etc/multichef/*.env` (chmod 640, owner `root:multichef_app`). Никогда не редактировать через `echo $TOKEN >> /etc/multichef/.env` без `chmod 640`.
- **Деплой** — через `scripts/deploy.sh` (MC-072). Не вручную копировать файлы через scp без версионирования.
- **Аудит** — каждое sudo-действие логируется в auditd, алерты в Sentry (MC-074).

Для восстановления доступа — см. `/root/.deploy-secrets/multichef/INVENTORY.md` §3.

---

## 7. Правила pnpm.overrides (ADR-0008)

`pnpm.overrides` в корневом `package.json` допустимы **только** по security-причине.

Каждый override должен:

1. Содержать ссылку на advisory (например, `GHSA-xxxx-yyyy-zzzz`)
2. Содержать дату пересмотра
3. Иметь обоснование в комментарии

Пример:

```json
"pnpm": {
  "overrides": {
    "fastify": "^5.12.1"  // CVE-2024-XXXX, reviewed: 2026-09-08
  }
}
```

При добавлении нового override — отдельный коммит с указанием advisory в commit message. `pnpm audit` в CI (MC-005) проверяет что без override'ов появляются уязвимости — иначе override лишний.

---

## 8. Conventional Commits + Conventional PR titles

Коммиты и PR-titles **обязаны** следовать [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]

[optional footer(s)]
```

Допустимые типы для MULTI-CHEF:

| Тип        | Использование                                                      |
| ---------- | ------------------------------------------------------------------ |
| `feat`     | Новая функциональность (новый endpoint, новый пакет, новая модель) |
| `fix`      | Баг-фикс                                                           |
| `docs`     | Только документация (не код)                                       |
| `chore`    | Инфраструктура, зависимости, конфиги                               |
| `refactor` | Рефакторинг без изменения поведения                                |
| `test`     | Только тесты                                                       |
| `ci`       | CI/CD изменения (workflow, Husky, gitleaks)                        |
| `perf`     | Оптимизация производительности                                     |
| `revert`   | Откат                                                              |

Scope — это имя MC-задачи (`mc-001`, `mc-002`) или пакета (`api`, `web`, `database`, `ci`).

Запрещены: `fix stuff`, `WIP`, `update`, `misc`, без префикса типа.

PR title повторяет commit subject.

---

## 9. Как запускать CI локально

| Задача                      | Команда                                                                       | Что проверяет                                 |
| --------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------- |
| Все проверки                | `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` | Полный pipeline без Docker                    |
| Только интеграционные тесты | `pnpm --filter @multichef/database test:integration`                          | Testcontainers, требует Docker                |
| env-coverage                | `pnpm run check:env-coverage`                                                 | 100% покрытие env                             |
| ADR-coverage                | `pnpm run check:adr-coverage`                                                 | Наличие всех 13 ADR + покрытие conventions.md |
| Prisma validate             | `pnpm --filter @multichef/database prisma validate`                           | Схема валидна                                 |
| Prisma format               | `pnpm --filter @multichef/database prisma format`                             | Схема отформатирована                         |
| Prisma diff                 | `pnpm --filter @multichef/database prisma:diff`                               | Сгенерировать SQL без применения              |

Если `test:integration` падает с «Testcontainers unavailable» — это норма для машин без Docker. В CI (MC-005) Docker будет.

---

## 10. Out-of-scope документы

`docs/MULTICHEF-ARCHITECTURE-PRD.md`, `docs/MULTICHEF-DEVELOPMENT-PLAN.md`, `docs/MULTICHEF-TESTING-STRATEGY.md` — **канонические документы главного архитектора**. Не редактируются без явного одобрения архитектора + оператора.

`markdownlint` исключает `docs/**/*.md` из автоматической проверки — эти документы проверяются ревью при PR.

---

## Что НЕ охвачено этим документом

- **CI/CD пайплайн** — Husky, commitlint, gitleaks, branch protection — MC-005
- **Playwright E2E** — MC-073
- **Playbook ротации секретов** — MC-090
- **PWA, hardening, deploy на multichef** — Фаза 7 (MC-070..MC-075, MC-080, MC-082)
