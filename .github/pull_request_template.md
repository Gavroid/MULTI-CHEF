## What

<!-- One-paragraph description of the change. Reference the MC number when relevant. -->

## Why

<!-- The motivation: link the issue / PRD section / ADR that explains why this change is needed. -->

## How it was verified

<!-- Check the boxes that apply; add rows as needed. -->

- [ ] `pnpm lint` passes
- [ ] `pnpm format:check` passes
- [ ] `pnpm typecheck` passes (includes `check:env-coverage` + `check:adr-coverage`)
- [ ] `pnpm test` passes
- [ ] `pnpm build` passes
- [ ] `pnpm --filter @multichef/database test:integration` passes (only when schema changed)
- [ ] `pnpm check` (alias for the five gates above) passes locally

## ADR

<!-- If this PR introduces a new architectural decision (new library, new pattern, scope expansion, breaking schema change), link the ADR here. -->

- [ ] No new ADR needed
- [ ] New ADR in `docs/decisions/`: `ADR-NNNN-…`

## Definition of Done

<!-- Copy the MC's DoD into this section so reviewers can check items inline. -->

- [ ] DoD item 1
- [ ] DoD item 2
- [ ] …

## Risks / rollback

<!-- What could break? How do we roll back? `git revert` is the default for non-merge commits. -->

## Out of scope

<!-- Anything explicitly deferred to a later MC. Helps reviewers spot scope creep. -->
