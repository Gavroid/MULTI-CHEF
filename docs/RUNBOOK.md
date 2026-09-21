# MULTI-CHEF Operations Runbook (v0.2.0)

> Operator-facing emergency + maintenance guide. Read this BEFORE
> any production change. Cross-check with [PLAN-PROD-LAUNCH.md](./PLAN-PROD-LAUNCH.md)
> and [CHANGELOG.md](./CHANGELOG.md).

## 1. Где что лежит

| Компонент        | Путь                                           | Команды                                                       |
| ---------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| Backend code     | `/opt/multichef/apps/api/`                     | `pnpm --filter @multichef/api build`                          |
| Frontend code    | `/opt/multichef/apps/web/`                     | `pnpm --filter @multichef/web build`                          |
| Worker (BullMQ)  | `/opt/multichef/apps/worker/`                  | `pnpm --filter @multichef/worker build`                       |
| Database         | Postgres 16 на `127.0.0.1:5432` БД `multichef` | `psql -h 127.0.0.1 -U multichef multichef`                    |
| Cache/Queue      | Redis 7 на `127.0.0.1:6379`                    | `redis-cli`                                                   |
| Backups daily    | `/var/lib/multichef/backups/`                  | (см. §5)                                                      |
| Backups off-host | `/var/lib/multichef/backups-offhost/`          | rsync mirror                                                  |
| Env              | `/etc/multichef/multichef.env`                 | `bash /opt/multichef/infrastructure/scripts/bootstrap-env.sh` |
| Logs systemd     | `journalctl -u multichef-api`                  |                                                               |
| Nginx gateway    | `/etc/nginx/sites-enabled/multichef.conf`      | `sudo nginx -t && sudo systemctl reload nginx`                |

## 2. Сервисы и состояния

```bash
sudo systemctl status multichef-api    # NestJS :3001
sudo systemctl status multichef-web    # Next.js :3000
sudo systemctl status multichef-worker # BullMQ
sudo systemctl status postgresql
sudo systemctl status redis-server
sudo systemctl status nginx
```

Smoke (через gateway :8080):

```bash
curl -fsS http://127.0.0.1:8080/api/v1/health/live
curl -fsS http://127.0.0.1:8080/api/v1/health/ready
curl -fsS http://127.0.0.1:8080/api/v1/health/sentry-ping
```

## 3. Алярмы из cron'а

| Cron                          | Что делает                   | Что если упал                           |
| ----------------------------- | ---------------------------- | --------------------------------------- |
| `*/5 * * * *` mc-monitor      | health-check + webhook alert | читать `/var/log/multichef-monitor.log` |
| `0 3 * * *` multichef-backup  | pg_dump + tarball            | читать `/var/log/multichef-backup.log`  |
| `0 4 * * 1` multichef-offhost | rsync mirror                 | читать `/var/log/multichef-offhost.log` |
| `0 6 * * 6` multichef-drill   | backup restore drill         | читать `/var/log/multichef-drill.log`   |

## 4. Типовые проблемы и лечение

### 4.1 API 500-е валятся массово

1. `journalctl -u multichef-api -n 200 --no-pager` — последние стектрейсы.
2. Если Postgres недоступен — проверить `sudo systemctl status postgresql` и `df -h /var/lib/postgresql`.
3. Если Redis недоступен — `redis-cli ping`. Должен вернуть `PONG`.
4. После починки зависимостей: `sudo systemctl restart multichef-api`.

### 4.2 Web отдаёт 502/504

1. `journalctl -u multichef-web -n 100` — nodejs error?
2. Если `next build` не выполнялся после изменения env или contracts — пересобрать:
   ```bash
   sudo -u multichef_app bash -c "cd /opt/multichef && pnpm --filter @multichef/contracts build"
   sudo -u multichef_app bash -c "cd /opt/multichef && pnpm --filter @multichef/web build"
   sudo systemctl restart multichef-web
   ```

### 4.3 Nginx 502

Nginx не достучался до api/web. Сначала чинить нижестоящий сервис (§4.1, §4.2).
Затем `sudo systemctl reload nginx`.

### 4.4 Миграция застряла

1. Найти имя из `journalctl -u multichef-api`.
2. Проверить блокировки:
   ```sql
   SELECT * FROM pg_locks WHERE NOT granted;
   ```
3. Если миграция частично применилась — НЕ запускать снова до разбора.
   Безопасный откат миграции — см. §6 (Rollback).

### 4.5 Auth rate-limit (429) для легитимного пользователя

Лимит 10 r/m с burst 20. Если пользователь с задержкой сети упирается
в лимит — увеличить `burst` в `/etc/nginx/sites-enabled/multichef.conf`

- `sudo systemctl reload nginx`.

### 4.6 Sentry не инициализируется

`/api/v1/health/sentry-ping → {active:false, dsn:"unset"}`.
Поставить `SENTRY_DSN=` в `/etc/multichef/multichef.env` и
`sudo systemctl restart multichef-api`.

## 5. Backup и восстановление

### 5.1 Что бэкапится

- `pg_dump --format=custom --jobs=4 multichef` → `/var/lib/multichef/backups/multichef-YYYYMMDD-HH.dump` (дневной)
- `/opt/multichef/data/` → `/var/lib/multichef/backups/data-YYYYMMDD-HH.tar.zst` (только если есть юзер-контент; после R17 — почти пусто)
- Off-host mirror → `/var/lib/multichef/backups-offhost/` (hardlinked)

### 5.2 Сделать бэкап руками

```bash
sudo /opt/multichef/infrastructure/scripts/backup.sh
ls -la /var/lib/multichef/backups/ | tail -5
```

### 5.3 Восстановить БД из дампа (drill)

```bash
sudo /opt/multichef/infrastructure/scripts/backup-restore-drill.sh
# Скрипт создаёт временную БД multichef_drill, грузит туда самый
# свежий дамп, считает строки в 3 ключевых таблицах и дропает.
```

### 5.4 Восстановить БД в прод (аварийное)

```bash
# 1. Остановить api, чтобы не было новых подключений.
sudo systemctl stop multichef-api multichef-worker

# 2. Восстановить.
pg_restore --clean --if-exists --dbname=multichef \
  /var/lib/multichef/backups/multichef-LATEST.dump

# 3. Запустить.
sudo systemctl start multichef-api multichef-worker
```

## 6. Rollback (release rollback)

### 6.1 Что откатываем

| Тип релиза           | Действие                                                       |
| -------------------- | -------------------------------------------------------------- |
| Только web (Next.js) | revert commit + rebuild + `systemctl restart multichef-web`    |
| Только api (NestJS)  | revert commit + rebuild + `systemctl restart multichef-api`    |
| Только worker        | revert commit + rebuild + `systemctl restart multichef-worker` |
| DB-миграция          | см. §6.3                                                       |

### 6.2 Что НЕ откатываем без подтверждения оператора

- Удаление столбцов / переименование (требует миграцию обратно)
- Изменение типа поля, потеря данных
- Любая несовместимая API-изменение (сломает мобильные/веб клиентов)

### 6.3 DB-миграция обратно

Перед merge миграции проверить `down`-метод в `packages/database/prisma/migrations/<id>/migration.sql`.
Prisma не умеет авто-down. Если down нет — план B:

1. Создать новую миграцию, отменяющую изменения вручную.
2. Тестировать на `multichef_drill` (см. backup-restore-drill).
3. Применить на прод: `cd /opt/multichef && sudo -u multichef_app pnpm --filter @multichef/database migrate:deploy`.

## 7. Чеклист при инциденте в проде

1. Подтвердить: `curl /health/ready` → ok / fail?
2. Глянуть `journalctl -u multichef-api -n 200`.
3. Глянуть `/var/log/multichef-{monitor,backup,drill,offhost}.log` (последний, что менялось).
4. Сделать `git log --oneline -5 main` — что в последних 5 коммитах?
5. Если в последних 5 — revert + redeploy (см. §6).
6. Если БД-миграция — применить down-миграцию (см. §6.3).
7. Если сетевая проблема (nginx, DNS, порт): перезагрузить `nginx`, проверить `ufw status`, проверить `ip a`.
8. Если внешний сервис не отвечает (Sentry, Telegram webhook) — проверить URL и `curl` снаружи.
9. Починить. Если не чинится 30 минут — эскалация на владельца продукта.

## 8. Контакты (для боевого дежурства — ЗАПОЛНИТЬ ОПЕРАТОРОМ)

- Владелец продукта: `@gavroid`
- DevOps on-call: `+7-XXX-XXX-XX-XX`
- Канал алертов: `<Slack/Telegram webhook URL>`
- База знаний: <wiki URL>

> Сейчас приложение в режиме **family-only LAN prod** для 1 домохозяйства.
> Если захочется выкатить наружу — перечитать §1 + план v0.3.0.
