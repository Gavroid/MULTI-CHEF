# R17-WP10 — Observability audit

## Stack state (no external services required)

| Layer           | Component                                                                                   | Status                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Errors          | `@sentry/node` (dynamic import)                                                             | Wired in `apps/api/src/main.ts` via `initSentry(env)`. No-op unless `SENTRY_DSN` is set in `/etc/multichef/multichef.env` |
| Health          | `infrastructure/scripts/health-check.sh` (api live + api ready + web /today + 4 auth cases) | Used in `deploy-safe.sh` smoke stage. exit 0 on the last 5 deploys                                                        |
| Synthetic probe | `infrastructure/scripts/mc-monitor.sh` (exit-0/1, Uptime-Kuma-friendly)                     | Added 2026-09-21. Tested live: `OK 2026-09-21T08:25:03Z`                                                                  |
| Cron            | `/etc/cron.d/multichef-health` (every 5 min, writes `/var/log/multichef-health.log`)        | Installed 2026-09-21                                                                                                      |
| Docker          | ad-hoc compose is not used (ADR-0006 bare-metal systemd); docker-compose.yml removed        | n/a                                                                                                                       |
| Lighthouse-ci   | not installed (R17 backlog)                                                                 | ⏳                                                                                                                        |

## DoD (smoke)

1. `bash infrastructure/scripts/mc-monitor.sh` → exit 0
2. `cat /etc/cron.d/multichef-health` → 1 cron entry, every 5m
3. `ls /var/log/multichef-health.log` → file exists, owned by multichef_app:adm
4. `curl -s /api/v1/health/live` → 200 `{"status":"ok"}`
5. `curl -s /api/v1/health/ready` → 200 `{"status":"ready"}`
6. `grep SENTRY_DSN /etc/multichef/multichef.env` → empty (Sentry no-op today, ready for env-var activation)

## Operator runbook additions

- Live problems: `tail -F /var/log/multichef-health.log`
- After deploy: `bash /opt/multichef/infrastructure/scripts/health-check.sh`
- Wire Uptime Kuma: add HTTP probe `http://192.168.1.95:8080/api/v1/health/ready`, interval 60s, retry 3
- Activate Sentry: `echo SENTRY_DSN=https://...@sentry.io/... >> /etc/multichef/multichef.env && systemctl restart multichef-api`
