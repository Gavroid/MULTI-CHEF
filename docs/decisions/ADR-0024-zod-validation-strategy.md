# ADR-0011: Zod validation in NestJS+Fastify — explicit schema in pipe

## Status

**Accepted** (2026-09-17). Will be revisited when upstream `nestjs-zod`
or NestJS restores reliable metatype reflection under Fastify.

## Date

**2026-09-17**

## Context

During R15 audit (MC-101) a problem was discovered: the globally
registered `ZodValidationPipe` for NestJS + Fastify did not validate
the body of POST /auth/register, and bodies with `email: "not-an-email"`
or empty email reached the service. The service is not designed for
this (`input.email.trim()` → TypeError → 500 INTERNAL_ERROR).

R15 closed the problem in two layers:

1. **MC-101 — pipe**: custom `ZodValidationPipe` reading the Zod schema
   as a **static field** on the DTO class (`metatype.schema`, populated
   by a local `createZodDto(Schema)` factory).
2. **MC-102 — service guards**: defensive `typeof input.email === 'string'`
   checks at the start of each service method.

Smoke 2026-09-17 on prod showed MC-101 did not fully close the bug:
`email: "not-an-email"` still returned **HTTP 201** and persisted the
user to the DB. Root cause: in NestJS 11 + Fastify,
`metadata.metatype` for `@Body()` does not always arrive as the DTO
class — it is often `Object` or `Function`, and the static-field
lookup `metatype.schema` returns `undefined`. The pipe becomes a no-op
and validation does not run.

## Decision

**MC-103**: the schema is passed to the pipe **explicitly via the
constructor** — `@Body(new ZodValidationPipe(RegisterBody))`. The pipe
no longer relies on `metadata.metatype` for schema discovery. The
static-field fallback (MC-101 legacy path) is kept for backward
compatibility but is no longer the primary mechanism.

All `@Body()` parameters of the auth controller (register, login,
logout, updateLocale) were migrated to explicit schema. New endpoints
MUST follow the same pattern.

**MC-102 service guards remain in the code** as defence-in-depth in
case a new endpoint forgets the explicit schema or the pipe logic
breaks upstream. Guards are not a replacement for the pipe — they are
the backup layer.

## Alternatives considered

- **`@Body(Schema, new ZodValidationPipe())` — pass schema as first
  arg.** Did not work: NestJS `@Body()` only accepts the DTO class as
  the first argument; a schema cannot be passed as a positional
  parameter.
- **Custom decorator `@ZodBody(Schema)` with `Reflect.getMetadata`.**
  More complex: the decorator writes metadata on the handler
  prototype keyed by `propertyKey`, the pipe must locate the handler
  from `metadata.metatype` — but `metatype` is not always equal to the
  handler constructor. Requires rebinding `ExecutionContext`. By
  the ratio "complexity / payoff" it lost to the explicit constructor.
- **Switch to Express adapter.** Eliminates the metatype problem but
  causes regressions on other axes (cookie serialization, throughput,
  already-configured middleware). Rejected.
- **Remove MC-102 guards and rely on the pipe alone.** Rejected: if a
  new endpoint forgets the explicit schema, the bug returns. This ADR
  fixes defence-in-depth as mandatory.

## Consequences

### Positive

- `email: "not-an-email"` now correctly returns 400 with a field-level
  `details.fields.email: ["Invalid email"]` — root cause closed.
- Explicit schema in `@Body()` is visible to code reviewers — no need
  to guess which Zod schema is applied.
- The pipe stays stateless and unit-testable in isolation
  (`zod-pipe-mc103.test.ts`, 9/9 pass).

### Negative

- Boilerplate per endpoint — `RegisterBody` / `LoginBody` / etc. must
  be explicitly imported from `auth.dto.ts` (do not confuse with
  `auth.dto-classes.ts`, which exports the TypeScript classes).
- MC-102 guards remain in `auth.service.ts` — 30+ lines of
  duplicated validation logic. The price of defence-in-depth.
- Any new endpoint that forgets
  `@Body(new ZodValidationPipe(Schema))` will pass through the pipe as
  a no-op and hit the MC-102 guard. **A lint rule that automatically
  requires a schema in the pipe has not been introduced** — TODO R17.

### Neutral

- The static-field fallback in the pipe is preserved but no longer
  primary — existing controllers using `@Body(new ZodValidationPipe())`
  without an argument will continue to work via the fallback (if
  their DTO is created via `createZodDto`).

## References

- `/opt/multichef/apps/api/src/common/zod-validation.pipe.ts` — pipe
  implementation (top-of-file comment refers to this ADR).
- `/opt/multichef/apps/api/src/auth/auth.controller.ts` — all 4
  `@Body()` calls with explicit schema.
- `/opt/multichef/apps/api/src/__tests__/zod-pipe-mc103.test.ts` — 9
  unit tests covering AC-1/AC-2/AC-4 without the service layer.
- R15 reports: `docs/audit/AUDIT-R15-SUMMARY.md` (MC-101, MC-102).
- R16 summary: `docs/audit/AUDIT-R16-SUMMARY.md` (MC-103).
