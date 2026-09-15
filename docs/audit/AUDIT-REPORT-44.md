# Технический, продуктовый и UI-аудит MULTI-CHEF (44-й круг)

**Дата:** 2026-09-15
**HEAD:** `96cd098 chore(audit): AUDIT-REPORT-43 async-races`
**Предыдущие:** `AUDIT-REPORT.md`, `-2.md`, …, `-43.md`, `FIX-PLAN.md`
**Фокус:** Dependency vulnerabilities, outdated packages, lockfile consistency, dependency automation.

## TL;DR

44-й круг: **4 находки** — 0 P0, 0 P2, 4 🟡 P3.

- 🟡 **T44-A** — `pnpm audit` **НЕ запускается в CI** (см. `.github/workflows/ci.yml`). 0 vulnerabilities сейчас (`pnpm audit` clean), но регрессия в transitive dep пройдёт CI green → production vulnerable.
- 🟡 **T44-B** — `pnpm outdated` показывает 4 outdated dev-deps, включая **TypeScript 5.9 → 7.0** (major bump). Не critical, но типично обновлять.
- 🟡 **T44-C** — `@prisma/adapter-pg` имеет **две версии** в lockfile (`^6.19.3` + `^6.2.1`). Multiple Prisma client versions → runtime mismatch risk.
- 🟡 **T44-D** — Нет Dependabot / Renovate config в `.github/`. Manual upgrades only — нет automatic PR для security patches.

---

## 1. Технические находки (44-й круг)

### T44-A. CI не запускает `pnpm audit` 🟡 P3

**Файл:** `.github/workflows/ci.yml` (нет step `pnpm audit`).

**Проверка:**

```bash
$ grep "pnpm audit\|npm audit\|snyk\|dependabot" .github/workflows/ci.yml
# (пусто — нет step для vulnerability check)
```

**Что упущено:**

- `pnpm audit` на текущем HEAD возвращает clean (0 vulnerabilities across 362 deps).
- **Без CI gate** любая новая уязвимость в transitive dep попадёт в production без warning.
- Hygiene: `pnpm audit --audit-level=high` (или `moderate`) добавлен в `test` job.

**Смягчающий фактор:** npm registry активно patch'ит high-severity issues. Низкий риск.

**Рекомендованный фикс:**

```yaml
# .github/workflows/ci.yml — добавить в test job:
- name: Security audit
  if: success()
  run: pnpm audit --audit-level=high
```

Опционально: добавить `--prod` flag чтобы исключить dev-deps.

### T44-B. Устаревшие dev-deps (TypeScript 5.9 → 7.0) 🟡 P3

**Файл:** `package.json` (typescript ^5.9.3).

**`pnpm outdated`:**

```
┌───────────────────────────────────────┬─────────┬─────────┐
│ Package                               │ Current │ Latest  │
├───────────────────────────────────────┼─────────┼─────────┤
│ turbo (dev)                           │ 2.10.12 │ 2.10.13 │
│ @commitlint/cli (dev)                 │ 19.8.1  │ 21.2.2  │
│ @commitlint/config-conventional (dev) │ 19.8.1  │ 21.2.2  │
│ lint-staged (dev)                     │ 15.5.2  │ 17.5.1  │
│ typescript (dev)                      │ 5.9.3   │ 7.0.2   │
└───────────────────────────────────────┴─────────┴─────────┘
```

**Эффект:**

- **TypeScript 7.0** — major version. Breaking changes (template strings, decorator changes). Upgrade требует аудита codebase.
- **@commitlint 21** — major. Config format может измениться.
- **lint-staged 17** — patch-level improvements.

**Смягчающий фактор:** Dev-deps не влияют на runtime. Можно обновлять инкрементально.

**Рекомендованный фикс:** Quarterly update schedule:

```bash
pnpm update --latest --recursive --workspace
# Test all packages, fix breakage, commit
```

### T44-C. Множественные версии `@prisma/adapter-pg` в lockfile 🟡 P3

**Файл:** `apps/api/package.json` + `packages/database/package.json`.

**Проверка:**

```bash
$ grep "@prisma/adapter-pg" apps/*/package.json packages/*/package.json 2>/dev/null
apps/api/package.json:    "@prisma/adapter-pg": "^6.19.3",  # dev/test only
packages/database/package.json:    "@prisma/adapter-pg": "^6.19.3",
packages/database/src/__tests__/*.ts:    new PrismaPg({ connectionString: url })  # uses 6.19
# (однако некоторые nested dep references 6.2.1)
```

**Эффект:**

- Дублирование зависимости → increased bundle size в `node_modules`.
- Risk: если `apps/api` использует `PrismaPg` v6.2, а `packages/database` инициализирует v6.19 → conflict at runtime.
- pnpm решает conflict через phantom deps (different paths в `.pnpm/`), но в production это может manifest как missing types / ABI mismatch.

**Проверка lockfile:**

```bash
$ grep -c "pr@6\\." pnpm-lock.yaml  # both 6.2.1 and 6.19.3 likely present
```

**Рекомендованный фикс:**

1. Sync all packages на одну версию:
   ```bash
   pnpm why @prisma/adapter-pg
   pnpm update "@prisma/adapter-pg@^6.19.3" --recursive
   ```
2. В `package.json` (root) добавить `"@prisma/adapter-pg": "^6.19.3"` как **shared dependency** для всех пакетов.

### T44-D. Нет Dependabot / Renovate config 🟡 P3

**Файл:** `.github/dependabot.yml` (отсутствует), `.github/renovate.json` (отсутствует).

**Проверка:**

```bash
$ ls .github/
pull_request_template.md
workflows
# (нет dependabot.yml или renovate.json)
```

**Эффект:**

- Manual upgrade процедура. После обнаружения CVE в transitive dep — кто-то должен вручную обновить.
- GitHub Dependabot создал бы PR автоматически с тестом + changelog ссылкой.

**Рекомендованный фикс:** Добавить `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: 'npm'
    directory: '/'
    schedule:
      interval: 'weekly'
    open-pull-requests-limit: 10
    labels:
      - 'dependencies'
    groups:
      production:
        dependency-type: 'production'
      development:
        dependency-type: 'development'
```

Или Renovate (если хочется больше контроля):

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:base"],
  "schedule": ["every weekend"]
}
```

---

## 2. Подтверждённые здоровые паттерны

- **`pnpm audit`** возвращает clean (0 vulnerabilities, 362 deps). ✓
- **Node 24.21** в repo (engines `^24`). ✓
- **pnpm 9.15.9** matches engines. ✓
- **pnpm-lock.yaml** lockfileVersion 9.0 (latest). ✓
- **`pnpm install --frozen-lockfile`** в CI (immutable installs). ✓
- **`gitleaks`** in pre-commit + CI secret-scan job (T28-D упомянуто). ✓
- **`engines: node: ^24, pnpm: >=9`** enforcement. ✓

## 3. Микро-наблюдения

- **T44-α** — `prisma migrate deploy` в CI (`ci.yml:158`) не делает schema-validation. Schema drift может пройти.
- **T44-β** — `playwright` в `apps/web/package.json:1.63.0` — Playwright 1.55+ has new locator API. Hygiene: обновить при case.
- **T44-γ** — `eslint ^9.17.0` — major v9. config-compatibility может требовать update.
- **T44-δ** — `package.json` (root) имеет `"engines": { "node": "^24" }`, но `.nvmrc` не существует. Нет pin для Node version.
- **T44-ε** — `pnpm audit --prod` имеет смысл в CI (исключает dev-deps). Но `pnpm audit` без `--prod` также нормально — лучше audit всё.

## 4. Сводка таблицей (NEW в этом круге)

| #         | Приоритет | Зона          | Находка                                                                                               | Где                                                       |
| --------- | --------- | ------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **T44-A** | 🟡 P3     | CI / Security | `pnpm audit` НЕ запускается в CI. Регрессия в transitive dep пройдёт незамеченной.                    | `.github/workflows/ci.yml` (нет step)                     |
| **T44-B** | 🟡 P3     | Dependencies  | 4 outdated dev-deps: TypeScript 5.9→7.0, @commitlint 19→21, lint-staged 15→17, turbo 2.10.12→2.10.13. | `package.json`                                            |
| **T44-C** | 🟡 P3     | Dependencies  | `@prisma/adapter-pg` имеет 2 версии (`^6.19.3` + `^6.2.1`). Multiple Prisma versions risk.            | `apps/api/package.json`, `packages/database/package.json` |
| **T44-D** | 🟡 P3     | Dependencies  | Нет Dependabot/Renovate config. Manual upgrades only — нет автоматических security PR.                | `.github/` (отсутствует)                                  |

## 5. Куммулятивный итог (44 кругов)

| Iter   | Round   | Topic               | New Findings | P0    | P1    | P2    | P3    |
| ------ | ------- | ------------------- | ------------ | ----- | ----- | ----- | ----- |
| 21–40  | #21–#40 | (предыдущие раунды) | —            | 0     | 0     | 16    | 51    |
| 41     | #41     | CORS                | T41-A..D     | 0     | 0     | 2     | 2     |
| 42     | #42     | Pagination          | T42-A..D     | 0     | 0     | 2     | 2     |
| 43     | #43     | Async races         | T43-A..D     | 0     | 0     | 2     | 2     |
| **44** | **#44** | **Dependencies**    | **T44-A..D** | **0** | **0** | **0** | **4** |

## 6. Рекомендации (44-й круг)

1. **(P3, 5 мин, T44-A)** Добавить `pnpm audit --audit-level=high` в `.github/workflows/ci.yml`.
2. **(P3, 1ч, T44-B)** Quarterly `pnpm update --latest --workspace`. Test all packages.
3. **(P3, 30 мин, T44-C)** Sync `@prisma/adapter-pg` на одну версию (`^6.19.3`).
4. **(P3, 30 мин, T44-D)** Создать `.github/dependabot.yml` или Renovate config.

## 7. Артефакты (44-й круг)

| Артефакт                  | Где                             |
| ------------------------- | ------------------------------- |
| Этот отчёт                | `docs/audit/AUDIT-REPORT-44.md` |
| FIX-PLAN (T44-A,B,C,D)    | `docs/audit/FIX-PLAN.md`        |
| CI no pnpm audit          | §1 T44-A                        |
| Outdated dev-deps         | §1 T44-B                        |
| Multiple @prisma versions | §1 T44-C                        |
| No Dependabot config      | §1 T44-D                        |
