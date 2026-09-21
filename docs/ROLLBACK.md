# MULTI-CHEF Rollback Procedure (v0.2.0)

> Шпаргалка для ОДНОВРЕМЕННОГО отката всех трёх сервисов на
> последний стабильный HEAD. Применимо для отката web/api/worker
> по любой причине (баг в prod, деградация p95, security advisory).

## Условия применения

Rollback **НЕ сработает корректно**, если:

- Между старым и новым HEAD-ом применялась миграция, которая
  удалила / переименовала столбец (данные уже потеряны).
- Изменилась схема API и старый web не совместим с новым api
  (или наоборот). Тогда делать **только web rollback** при
  неизменённой api, или vice versa.

## Шаг 0: snapshot текущего состояния (для postmortem)

```bash
sudo systemctl status multichef-api multichef-web multichef-worker
journalctl -u multichef-api -n 500 > /tmp/postmortem-api.log
journalctl -u multichef-web -n 500 > /tmp/postmortem-web.log
journalctl -u multichef-worker -n 500 > /tmp/postmortem-worker.log
sudo -u multichef_app git -c safe.directory=/opt/multichef log --oneline -10 > /tmp/postmortem-commits.txt
```

## Шаг 1: выбрать целевой HEAD

```bash
cd /opt/multichef
sudo -u multichef_app git -c safe.directory=/opt/multichef log --oneline -10 main
# Выбрать SHA, например db5d1af (последний стабильный по operator).
TARGET=db5d1af
```

## Шаг 2: revert коммитов между текущим main и TARGET

```bash
# Создать ветку rollback, чтобы сохранить diff для анализа.
sudo -u multichef_app git -c safe.directory=/opt/multichef \
    checkout -b rollback/manual-$(date -u +%Y%m%dT%H%M%SZ) $TARGET
sudo -u multichef_app git -c safe.directory=/opt/multichef checkout main
# На main — git revert, не reset, чтобы не переписывать историю.
sudo -u multichef_app git -c safe.directory=/opt/multichef \
    revert --no-edit main..rollback/manual-$(date -u +%Y%m%dT%H%M%SZ)
```

> Если коммитов много, можно `git revert main..${TARGET}` одним
> вызовом — revert сам разобьёт по коммитам.

## Шаг 3: пересборка и рестарт сервисов

```bash
sudo chown -R multichef_app:multichef_app /opt/multichef
sudo -u multichef_app bash -c "cd /opt/multichef && pnpm install --frozen-lockfile --reporter=ndjson"
sudo -u multichef_app bash -c "cd /opt/multichef && pnpm \
    --filter @multichef/config --filter @multichef/contracts \
    --filter @multichef/database --filter @multichef/nutrition \
    --filter @multichef/recommendation build"

sudo -u multichef_app bash -c "cd /opt/multichef && pnpm --filter @multichef/api build"
sudo -u multichef_app bash -c "cd /opt/multichef && pnpm --filter @multichef/web build"
sudo -u multichef_app bash -c "cd /opt/multichef && pnpm --filter @multichef/worker build"

sudo systemctl restart multichef-api
sudo systemctl restart multichef-web
sudo systemctl restart multichef-worker
```

## Шаг 4: smoke

```bash
# Подождать старта (5–10 секунд обычно хватает).
sleep 10

curl -fsS http://127.0.0.1:8080/api/v1/health/live
curl -fsS http://127.0.0.1:8080/api/v1/health/ready
curl -fsSI http://127.0.0.1:8080/today | head -3
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/auth/login
# 200 = login page ok
```

## Шаг 5: если БД-миграция требует down

Если между старым и текущим HEAD применялась миграция, которая
меняет схему:

```bash
# 1. Стоп API чтобы не было новых подключений.
sudo systemctl stop multichef-api multichef-worker

# 2. Создать новую миграцию, отменяющую изменения (см. RUNBOOK §6.3).

# 3. Применить:
sudo -u multichef_app bash -c "cd /opt/multichef/packages/database && \
    DATABASE_URL='postgres://multichef:PASSWORD@127.0.0.1:5432/multichef' \
    pnpm prisma migrate deploy"

# 4. Старт API/worker.
sudo systemctl start multichef-api multichef-worker
```

## Шаг 6: postmortem

1. Заполнить /docs/postmortem/YYYY-MM-DD-<incident>.md с таймлайном.
2. Создать задачу в backlog: "Улучшить coverage/мониторинг, чтобы
   следующий такой же баг поймать раньше".
3. Если баг был в проде > 30 минут — ответить в канале алертов с
   описанием, root cause и ETA фикса.

## Шпаргалка одной строкой

```bash
# Emergency-only. Один командный блок. БЕЗ подтверждений.
# Использовать только когда оператор подтвердил.
sudo systemctl stop multichef-api multichef-web multichef-worker && \
cd /opt/multichef && sudo -u multichef_app git -c safe.directory=/opt/multichef \
    fetch origin && \
sudo -u multichef_app git -c safe.directory=/opt/multichef \
    checkout origin/main && \
sudo chown -R multichef_app:multichef_app /opt/multichef && \
sudo -u multichef_app bash -c "pnpm install --frozen-lockfile --reporter=ndjson && \
    pnpm --filter @multichef/api build && \
    pnpm --filter @multichef/web build && \
    pnpm --filter @multichef/worker build" && \
sudo systemctl start multichef-api multichef-web multichef-worker
```
