# ADR-0025: API/Web bind to loopback (127.0.0.1) by default in prod

## Status

**Accepted** (2026-09-17).

## Date

**2026-09-17**

## Context

The PRD for MULTI-CHEF stated that the NestJS API (port 3001) and the
Next.js web (port 3000) bind to `127.0.0.1` in production, with nginx
as the only publicly-reachable front (ports 8080/8443). On audit R16
(2026-09-17) live-state check #3 caught a violation: `ss -tlnp` showed
both processes listening on `0.0.0.0` instead of `127.0.0.1`.

Why this matters:

- **Attack surface**: binding on `0.0.0.0` exposes the raw Node.js
  process to any host that can route to `.95`. Even though nginx
  filters incoming requests, a misconfigured nginx rule or a firewall
  hole would directly expose the Node.js process with no rate-limiting,
  no helmet middleware, and no CSRF cookie scoping.
- **PRD compliance**: the deployment model is documented as
  systemd-bare-metal + nginx gateway. Direct binding on `0.0.0.0`
  breaks that contract.

Why it happened:

- API: `apps/api/src/main.ts` line 147 hardcoded
  `app.listen(env.API_PORT, '0.0.0.0')`. No env override existed.
- Web: `apps/web/package.json` `start` script invoked
  `next start -p ${WEB_PORT:-3000}` without a `-H` flag, so Next.js
  defaulted to `0.0.0.0`.

## Decision

1. `packages/config/src/env.schema.ts` — add `API_HOST` to
   `serverEnvSchema`, default `'127.0.0.1'`. Override via env when
   running in dev containers or behind a different reverse proxy.
2. `apps/api/src/main.ts` — replace the hardcoded `'0.0.0.0'` with
   `env.API_HOST` (default `127.0.0.1`).
3. `apps/web/package.json` — change `start` script to
   `next start -p ${WEB_PORT:-3000} -H ${WEB_HOST:-127.0.0.1}`.
   `WEB_HOST` env is read by the systemd unit; if absent, defaults to
   `127.0.0.1`.
4. `infrastructure/scripts/health-check.sh` — add a port-binding gate
   that fails when either `:3000` or `:3001` is bound to a non-loopback
   address. This makes the regression auto-detectable.
5. nginx config — unchanged. nginx already proxies to `127.0.0.1:3000`
   and `127.0.0.1:3001` (verified during audit R17).

## Alternatives considered

- **Firewall-only fix (iptables on INPUT)**: zero code change, prod-local.
  Rejected — hides the bug instead of fixing it, and a later
  re-deploy could re-introduce the bug if someone reverts the
  firewall rule.
- **Remove the systemd unit `EnvironmentFile=/etc/multichef/multichef.env`**
  and inline the config: too invasive, every other env-driven knob
  would have to move.
- **Add `IPV6_V6ONLY=0` and bind to `[::1]`**: doesn't fix IPv4
  exposure, only narrows the gap.
- **Bind on a unix socket**: removes port semantics but breaks the
  current nginx `proxy_pass http://127.0.0.1:PORT` syntax. Out of
  scope.

## Consequences

### Positive

- API/Web processes reachable only via the loopback interface.
  Direct attacks against Node.js (bypassing nginx) require local
  shell access.
- Drift from the PRD baseline is now mechanically enforced by
  health-check stage 4.
- Override via env still works for dev (Docker Compose, test
  containers) without code changes.

### Negative

- One more env knob to document (`API_HOST`, `WEB_HOST`). Mitigated
  by sensible defaults in env schema.
- Future contributors must remember to update health-check if they
  add a new public-facing port. Mitigated by ADR-0024's lint-rule
  pattern (TODO R17).

### Neutral

- systemd unit files remain unchanged — they don't need to set
  `API_HOST`/`WEB_HOST` explicitly because the defaults are correct
  for prod. If a deployment environment ever needs `0.0.0.0`, it
  adds the override to its own env file, not to the unit.

## References

- `packages/config/src/env.schema.ts` — `API_HOST` schema entry.
- `apps/api/src/main.ts` — `app.listen(env.API_PORT, env.API_HOST)`.
- `apps/web/package.json` — `start` script with `-H ${WEB_HOST:-127.0.0.1}`.
- `infrastructure/scripts/health-check.sh` — stage 4 port-binding gate.
- R16 summary: `docs/audit/AUDIT-R16-SUMMARY.md` (live-state check #3).
