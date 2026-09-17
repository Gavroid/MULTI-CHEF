# MULTI-CHEF — Audit Plan (R16+)

> Comprehensive plan for the next audit round(s). Built on R13/R14/R15
> findings. Each track has its own test cases, acceptance criteria,
> and exit conditions. Designed to be runnable in any order by a
> single agent with prod SSH + GitHub access.

---

## 0. Scope and constraints

**Target:** `multichef` production deployment (`192.168.1.95`,
`HEAD = e21d898`). Code in `apps/{web,api,worker}` + `packages/{config,
contracts,database,nutrition,recommendation,ui,eslint-config,
typescript-config}`. Infrastructure in `infrastructure/{nginx,scripts,
systemd}`. Docs in `docs/` and `DEPLOY.md`.

**Agent's available tools:**

- SSH to `multichef` (key `~/.ssh/id_ed25519_deploy`)
- GitHub REST API (PAT in `~/.config/gh/host.yml`, use via `TOK=$(grep -oE ...)`)
- File read/write on manager-host (`/root/workspace/multi-chef/`)

**Audit rules of engagement:**

1. Every change ships as a fix-PR (`MC-XXX-name`) on a feature branch
   that gets squash-merged to `main` only after CI is green and
   `deploy-safe.sh` has been rehearsed.
2. Every `mc_user` localStorage decision is documented in the
   branch's PR description ("audit round-N — 2026-09-DD").
3. No destructive operations on prod without operator approval:
   - DB schema migrations → ADR + operator ACK
   - Volume / backup deletion → explicit ACK
   - `docker system prune`, `ufw`/`sshd` changes outside MC-080 → ACK
4. Backups taken before any change (`/opt/multichef/infrastructure/scripts/backup.sh`).
5. **Defense in depth: CI gates run BEFORE prod mutation.** The
   `deploy-safe.sh` script enforces this for every deploy.

---

## 1. Track layout

| Track                 | Owner concern                           | Time est. | Risk     |
| --------------------- | --------------------------------------- | --------- | -------- |
| T-A Tech audit        | runtime correctness, security, perf     | 2 days    | LOW-MED  |
| T-B Product audit     | data model, business logic, contracts   | 2 days    | MED-HIGH |
| T-C UI audit          | a11y, mobile, design system consistency | 1 day     | LOW      |
| T-D Infra audit       | backups, observability, secrets, deploy | 1 day     | MED      |
| T-E Compliance / GDPR | privacy, retention, deletion, consent   | 0.5 day   | MED      |

Each track is independently runnable. Total budget: ~6.5 working days.

---

## 2. T-A — Technical audit

### T-A.1 MC-103 — Fastify + createZodDto metatype investigation

**Status from R15:** ZodValidationPipe fires on `@Body(new ZodValidationPipe())` but receives `metatype = Function` (default), not the actual DTO class. Pipe no-ops. Currently masked by MC-102 service-level guards.

**Acceptance criteria:**

- AC-1: Send POST /auth/register with `{"email":"not-an-email","password":"abcdefgh"}` and receive `HTTP 400 VALIDATION_ERROR` with `details.fields.email = ["Invalid email"]` (NOT 201 with a user that has `email: "not-an-email"`).
- AC-2: Pipe-level validation works WITHOUT the service-level `typeof` guards in `AuthService.register` — i.e. removing MC-102 still produces AC-1.
- AC-3: All other Zod-DTOs (`LoginDto`, `LogoutDto`, `LocaleDto`) are also validated by the pipe.

**Diagnostic steps:**

1. Add temporary `console.log` in `apps/api/src/common/zod-validation.pipe.ts` (already done in R15; can reuse).
2. Compare NestJS Express vs Fastify adapter behaviour — express may pass `metatype` correctly.
3. Try `@Body(Schema, ZodValidationPipe)` form instead of `@Body(new ZodValidationPipe())`.
4. Try `Reflect.defineMetadata(ZOD_SCHEMA, schema, handler, paramIndex)` from inside `createZodDto` and read it from the pipe.

**Test cases (Vitest/Node test runner — same convention as existing `apps/api/src/__tests__/`):**

```ts
// apps/api/src/__tests__/zod-pipe.test.ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { RegisterDto } from '../auth/auth.dto-classes.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';

describe('ZodValidationPipe with createZodDto (MC-103)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({}).compile();
    app = mod.createNestApplication();
    // Use Fastify to match prod.
    // app = mod.createNestApplication(new FastifyAdapter());
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();
  });

  it('rejects empty email at the pipe level', async () => {
    // Arrange: build a controller that echoes RegisterDto
    // Assert: request with empty email returns 400, controller not called
  });

  it('rejects bad email format', async () => {
    // {"email":"not-an-email","password":"abcdefgh"} -> 400 with email field error
  });

  it('strips unknown fields when strict()', async () => {
    // {"email":"x@y","password":"abcdefgh","extra":"junk"} -> 400
  });

  it('lowercases email before passing to service', async () => {
    // {"email":"X@Y.COM","password":"abcdefgh"} -> controller receives lowercase
  });
});
```

### T-A.2 MC-105 — Audit NestJS + Fastify pipe metatype semantics

This is the **research task** behind T-A.1. Without fixing the root cause, MC-102 (defensive guards) is the only thing preventing the regression. Document the choice in `docs/decisions/ADR-0010-zod-validation-strategy.md`.

**Acceptance criteria:**

- AC-1: ADR exists and is referenced from `apps/api/src/common/zod-validation.pipe.ts`.
- AC-2: ADR explicitly says "all new endpoints with Zod-DTOs MUST include service-level guards until MC-103 is closed".

### T-A.3 Security — known issues from R13/R14 not yet fully closed

From audit-r14 SUMMARY:

- IDOR pantry ULID — fixed in PR#52, verify in runtime.
- CSRF soft mode — verify mc_csrf cookie is set on every login/register.
- Rate limit `trustProxy:true` XFF-spoof — verify only `127.0.0.1` is trusted.
- Planner КБЖУ deviation >10% — verify `USE_MEALPLAN_MOCK=0` in `tests/e2e/real-plan-deviation.spec.ts`.

**Acceptance criteria:**

- AC-1: `pnpm test` exits 0 with all 161+ tests pass.
- AC-2: `pnpm --filter @multichef/api test:integration` exits 0 (requires Docker — only run on CI runner, not locally).
- AC-3: Manual probe via `curl` — register flow sets `mc_csrf` cookie, second POST without cookie is rejected.
- AC-4: Real-plan deviation ≤ 10% over 100 random target KБЖУ inputs.

### T-A.4 Performance baseline

**Acceptance criteria:**

- AC-1: `POST /api/v1/recommendations/today` p95 ≤ 500ms (from CHANGELOG.md).
- AC-2: `GET /api/v1/recipes` p95 ≤ 200ms with 269 recipes.
- AC-3: `POST /api/v1/meal-plans/generate` (BullMQ job) p95 ≤ 3s for `n=7 days`.

**Test method:**

```bash
# On multichef, with prod running:
hey -n 200 -c 10 -m POST http://localhost:8080/api/v1/recommendations/today \
  -H 'Content-Type: application/json' \
  -d '{"mood":"NEUTRAL","effort":"MEDIUM","budget":"NORMAL"}'
```

(needs `hey` installed; or use `wrk`/`ab`).

### T-A.5 Logger hygiene

Audit R14 noted: "no service-level logger — request-scoped errors
are handled (once, structured) by AppHttpExceptionFilter. Re-add a
Logger only with a concrete log statement that needs it."

**Acceptance criteria:**

- AC-1: Every `throw new AppHttpException({code, message})` in
  service layer surfaces in journalctl with the code/message.
- AC-2: No silent error swallowing (`catch { return null }` without
  `this.logger.error`).

---

## 3. T-B — Product audit

### T-B.1 MC-200 — Recipe data quality

**Source:** `PLAN-2000-RECIPES.md` (Audit-R13 plan). Currently 269
recipes, target 2000. R13 already drafted the implementation.

**Acceptance criteria (from PLAN-2000-RECIPES.md §1):**

- D1: 2000 recipes in status `PUBLISHED`
- D2: 100% have `imageKey` → accessible webp
- D3: 100% have description (1–2 sentences)
- D4: ≥95% have instructions ≥4 steps, total ≥300 chars
- D5: 100% have portion 100–800 g (drinks 150–400 ml)
- D6: 100% have КБЖУ with `calculationVersion=2`, kcal/portion in band
- D7: 0 exact duplicates (trigram similarity ≥0.9)
- D8: `IngredientNutrition` filled for all 300+ ingredients
- D9: E2E 6/6, plan generation p95 < 3s at n=2000, disk ≤ 8GB
- D10: Rollback = `status=DRAFT` for the wave's slug list

**Test cases:**

```ts
// apps/api/src/recipes/__tests__/recipe-quality.test.ts
describe('Recipe quality gate (D1–D8)', () => {
  it('counts PUBLISHED recipes', async () => {
    const n = await getPrisma().recipe.count({ where: { status: 'PUBLISHED' } });
    expect(n).toBeGreaterThanOrEqual(2000);
  });

  it('every PUBLISHED recipe has an accessible webp', async () => {
    // GET each imageKey via nginx /_storage/, expect 200
  });

  it('no exact duplicate titles (trigram)', async () => {
    const dups = await getPrisma().$queryRaw`
      SELECT title, count(*) FROM "Recipe"
      WHERE status = 'PUBLISHED'
      GROUP BY title HAVING count(*) > 1`;
    expect(dups).toEqual([]);
  });

  it('every PUBLISHED recipe has КБЖУ in band', async () => {
    const out = await getPrisma().$queryRaw`
      SELECT id FROM "Recipe"
      WHERE "calculationVersion" != 2
         OR "servingCalories" < 120 OR "servingCalories" > 1200`;
    expect(out).toEqual([]);
  });
});
```

### T-B.2 Meal planner КБЖУ accuracy

**Acceptance criteria:**

- AC-1: `pickTop3` returns 3 options (`FROM_PANTRY`, `BEST_MATCH`, `CHAIN`) in deterministic order given fixed RNG seed.
- AC-2: For 100 random households (peopleCount ∈ {1..6}, target_kcal ∈ {1500..2500}), avg daily deviation ≤ 10%.
- AC-3: When pantry is empty, `FROM_PANTRY` falls back to `least-missing`, not null.

**Test cases** (existing `apps/api/src/recommendations/__tests__/pick-top3.spec.ts` already covers some; extend):

```ts
it('100 random households: avg deviation ≤ 10%', async () => {
  const deviations: number[] = [];
  for (let i = 0; i < 100; i++) {
    const hh = randomHousehold(seedRng(i));
    const plan = await planWeek(hh);
    const avg = plan.dailyKcal.reduce((a, b) => a + b, 0) / plan.dailyKcal.length;
    deviations.push(Math.abs(avg - hh.targetKcal) / hh.targetKcal);
  }
  const avgDev = deviations.reduce((a, b) => a + b, 0) / deviations.length;
  expect(avgDev).toBeLessThanOrEqual(0.1);
});
```

### T-B.3 Shopping list utility scoring

**Acceptance criteria:**

- AC-1: `utilityScore` is in [0..10] for every `ShoppingListItem`.
- AC-2: When `budgetWeekKopecks` is set, `fitBudget` proposals respect it (sum ≤ budget * 1.05).
- AC-3: Marking item purchased → pantry upsert is transactional (no orphan rows).

### T-B.4 Storage plan and prep session

**Acceptance criteria:**

- AC-1: Prep session tasks are deduplicated across recipes (no two tasks for the same ingredient+method).
- AC-2: Parallel-task groups don't share ingredients between concurrent steps.
- AC-3: Freezer assignment for `days ≥ 3` is deterministic.
- AC-4: Defrost calendar sets `defrostAt = consumeAt - 1 day` for frozen items.

---

## 4. T-C — UI audit

### T-C.1 WP-2 — `<img>` loading/decoding/dimensions (T3)

Already in `PLAN-P0-BACKLOG.md`. R14 audit lists this as a TODO.

**Acceptance criteria:**

- AC-1: `grep -rnE '<img\b' apps/web/src --include='*.tsx'` → every match has `loading=` and `width=`/`height=` (or aspect-ratio wrapper).
- AC-2: Lighthouse `/recipe/<id>` LCP ≤ 2.5s, CLS ≤ 0.1.
- AC-3: axe: 0 new violations after the change.

**Test cases:**

```ts
// apps/web/src/__tests__/image-attributes.test.ts
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

describe('Every <img> has loading/decoding/dimensions (WP-2)', () => {
  const root = join(__dirname, '../../src');
  const files: string[] = [];
  function walk(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && p.endsWith('.tsx')) files.push(p);
    }
  }
  walk(root);

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const imgs = src.match(/<img\b[^>]*>/g) ?? [];
    for (const img of imgs) {
      it(`${file}: <img> has loading + dimensions`, () => {
        expect(img).toMatch(/\bloading=/);
        expect(img).toMatch(/\b(width=|height=)/);
      });
    }
  }
});
```

### T-C.2 WP-3 — SEO basics (T1)

**Acceptance criteria:**

- AC-1: `/robots.txt` exists and disallows `/api/`, `/admin/`.
- AC-2: `/sitemap.xml` exists and references public pages (recipes, today, plan).
- AC-3: Every page has `<title>`, `<meta name="description">`, og:image.

### T-C.3 WP-4 — WCAG color contrast + a11y

**Acceptance criteria:**

- AC-1: axe: 0 violations on `/today`, `/recipe/<id>`, `/fridge`, `/plan`, `/shopping/<id>`.
- AC-2: All interactive elements have visible focus state.
- AC-3: Form fields have associated `<label>` (no `placeholder`-only labels).

### T-C.4 Mobile / PWA

**Acceptance criteria:**

- AC-1: Lighthouse PWA audit passes (manifest + service worker + installable).
- AC-2: `manifest.json` has icons (192, 512) and theme color.
- AC-3: Offline: `/today` cached, `/plan` cached, recipes cached. New data on reconnect.

---

## 5. T-D — Infrastructure audit

### T-D.1 Backup restore-test (runbook)

**Acceptance criteria:**

- AC-1: A real restore (to a separate DB) is documented and tested quarterly.
- AC-2: Restore procedure in `docs/runbooks/disaster-recovery.md`.
- AC-3: Most recent backup is ≤ 26 hours old.

**Procedure** (to run on a separate test host, NOT on prod):

```bash
sudo -u postgres dropdb multichef_restore_test
sudo -u postgres createdb multichef_restore_test
sudo -u postgres pg_restore -d multichef_restore_test \
  /var/lib/multichef/backups/multichef-$(date -u +%Y%m%d)T030001Z.sql.gz
sudo -u postgres psql multichef_restore_test -c "SELECT count(*) FROM \"User\"; SELECT count(*) FROM \"Recipe\";"
```

### T-D.2 Observability — Sentry / Prometheus

**Acceptance criteria:**

- AC-1: API unhandled exceptions report to Sentry (verify by triggering a controlled error).
- AC-2: `/metrics` endpoint exposes request count + 5xx count + p95.
- AC-3: `journalctl` retention is bounded (configurable).

### T-D.3 Secrets rotation

**Acceptance criteria:**

- AC-1: `rotate-secrets.sh` exists (it does — `/opt/multichef/infrastructure/scripts/rotate-secrets.sh`).
- AC-2: Runbook in `docs/runbooks/secret-rotation.md`.
- AC-3: After rotation, deploy-safe exits 0.

### T-D.4 Port binding — already-flagged issue from R15

**Acceptance criteria:**

- AC-1: `ss -tlnp | grep -E ":3000|:3001"` shows `127.0.0.1` only (not `0.0.0.0`).
- AC-2: `multichef-web.service` and `multichef-api.service` use `HOST=127.0.0.1` or systemd `SocketBindAllow=127.0.0.1`.

---

## 6. T-E — Compliance / GDPR

### T-E.1 Account deletion

**Acceptance criteria:**

- AC-1: `DELETE /api/v1/users/me` removes all related rows (User, Session, Household, HouseholdMember, Pantry, PantryItem, Preference, MealPlan, ShoppingList, etc.).
- AC-2: Soft-delete (`status=DELETED`) keeps referential integrity for 30 days, hard-delete after.

### T-E.2 Data export

**Acceptance criteria:**

- AC-1: `GET /api/v1/users/me/export` returns JSON with all user data.
- AC-2: Schema is documented in `docs/api/user-export.md`.

### T-E.3 Cookie consent / privacy banner

**Acceptance criteria:**

- AC-1: First visit shows cookie banner.
- AC-2: Until accepted, no analytics/tracking cookies are set.

---

## 7. Cross-cutting test harness

A single command should run all unit tests + lint + typecheck + format:

```bash
ssh multichef 'cd /opt/multichef && sudo -u root /usr/bin/pnpm --silent lint && \
  /usr/bin/pnpm --silent typecheck && \
  /usr/bin/pnpm --silent test && \
  /usr/bin/pnpm --silent format:check && \
  /usr/bin/pnpm --silent build && \
  /usr/bin/pnpm --silent audit --prod --audit-level=high && \
  gitleaks detect --source . --no-banner && \
  /opt/multichef/infrastructure/scripts/health-check.sh http://127.0.0.1:8080'
```

(Exactly the same gates `deploy-safe.sh` runs in stage 1, but without
the git-pull side-effects.)

---

## 8. Acceptance for closing a round

A round (e.g. R16) is "done" when:

- All AC-1..N for the round's tasks are green (test command output
  captured in `docs/audit/<round>.md`).
- `deploy-safe.sh --ref origin/main` exits 0 against the round's HEAD.
- `docs/audit/<round>-SUMMARY.md` written (same template as R13/R14/R15).
- `git log` shows only clean conventional-commits on main.
- CI on GitHub shows all 7 checks green.

---

## 9. Out of scope (post-MVP)

| Item                                         | Reason                                          |
| -------------------------------------------- | ----------------------------------------------- |
| Распознавание продуктов по фото холодильника | §1.5 PRD                                        |
| Сканирование чеков                           | §1.5 PRD                                        |
| Voice input                                  | §1.5 PRD (button can be added, behaviour later) |
| Реальные цены магазинов / доставка           | §1.5 PRD                                        |
| Python OR-Tools optimiser                    | §1.5 PRD (TS heuristic is in MVP)               |
| Family profiles with separate КБЖУ goals     | §1.5 PRD (DB structure is in place)             |
| OAuth / passkeys                             | §1.5 PRD                                        |
| pgvector semantic search                     | §1.5 PRD (extension installed, not used)        |
| Custom user recipes                          | §1.5 PRD                                        |
| "Saved product" stats                        | §1.5 PRD                                        |

---

## 10. References

- `docs/MULTICHEF-ARCHITECTURE-PRD.md` — single source of truth
- `docs/MULTICHEF-DEVELOPMENT-PLAN.md` — 34 tasks MC-001..MC-090
- `docs/MULTICHEF-TESTING-STRATEGY.md` — test methodology
- `docs/PLAN-P0-BACKLOG.md` — WP-1..WP-5 P0 leftover
- `docs/PLAN-2000-RECIPES.md` — recipe catalogue expansion
- `docs/audit/AUDIT-REPORT-71.md` — most recent pre-R15 audit
- `docs/audit/AUDIT-R15-SUMMARY.md` — current audit summary
- `DEPLOY.md` — production deploy procedure
- `infrastructure/scripts/deploy-safe.sh` — 7-stage safe-deploy

---

## 11. Change history

| Date       | Author             | Change                       |
| ---------- | ------------------ | ---------------------------- |
| 2026-09-17 | Hermes Agent (R15) | Initial plan after R15 close |
