# MULTI-CHEF — test artifact

This file is the first intentional commit in the repository.

## Purpose

- Smoke-check that the SSH key on manager-host can push to GitHub.
- Provide a Markdown target so the `hello CI` workflow can run `markdownlint`.
- Mark the repository as alive and ready for the deployment plan described
  in `MULTICHEF-ARCHITECTURE-PRD.md` (Блок 6).

## Status

- Repository: private
- Visibility: Gavroid only
- CI: minimal GitHub Actions (`hello CI` workflow)
- Deploy: planned, not wired yet (see PRD §6.7 — `deploy.sh` lives on `multichef`)
