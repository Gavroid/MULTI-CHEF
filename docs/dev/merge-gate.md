# Merge gate

`scripts/merge_gate.py` is a GitHub-side guard that blocks
squash-merge unless CI is green on the **exact head-SHA** the manager
intends to merge. It exists because free-tier GitHub private repos do
not allow branch-protection rules that reject out-of-date merges via
the API; this script closes the gap from the manager host.

## Why

`gh pr merge --squash --sha <X>` will accept any `<X>` argument the
manager passes — including a SHA that's already been superseded by a
newer commit on the PR branch. Without this check, the race below
can land untested code on `main`:

1. PR opened at `abc123`, CI green.
2. Author force-pushes or merges `main`, head-SHA becomes `def456`.
3. Manager runs `gh pr merge --squash --sha abc123`.
4. `abc123` was last green on CI but `def456` was never tested. The
   merge API call succeeds because GitHub does not require the
   provided SHA to match the current `head.sha`.

The merge-gate script verifies the world **right before** the manager
fires the merge call:

1. SHA the manager passed == `pulls/{n}.head.sha` from the GitHub API.
2. `actions/runs?head_sha=<sha>` returns at least one run.
3. The most recent run has `status: completed` + `conclusion: success`.
4. Every required CI job (default: `lint typecheck test build
secret-scan`) is present and `conclusion: success`.

If any of these fails, the script exits 1 and prints a clear reason
to stderr — the manager should NOT run `gh pr merge` afterwards.

## Usage

```bash
# 1. Look up the head SHA the manager intends to merge on
SHA=$(gh pr view <PR> --json headRefOid -q .headRefOid)

# 2. Run the gate
python3 scripts/merge_gate.py \
    --pr <PR> \
    --sha "$SHA" \
    --repo Gavroid/MULTI-CHEF \
    --token-file /root/.config/gh/host.yml

# 3. If ✅ MERGE-GATE PASSED, proceed with the actual merge
gh pr merge <PR> --squash --sha "$SHA"
```

A convenience wrapper `scripts/merge-gate.example.sh` does steps 1–2:

```bash
./scripts/merge-gate.example.sh <PR> <HEAD_SHA>
```

## Exit codes

| Code | Meaning                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------- |
| `0`  | All checks passed — safe to `gh pr merge --squash`.                                                         |
| `1`  | Gate failed: SHA mismatch, CI not completed, CI failed, or required check missing/failed. **Do not merge.** |
| `2`  | Operator error: missing token, unreadable token file, malformed YAML, or 4xx from GitHub API.               |

## Token resolution

The token is read from one of two places, in order:

1. `--token-file PATH` — YAML file. Accepts both layouts produced by
   `gh auth login`:
   ```yaml
   github.com:
     oauth_token: ghp_…
     user: gavroid
   ```
   or a flat `{ oauth_token: ghp_… }`.
2. `$GITHUB_TOKEN` (or `$GH_TOKEN`) environment variable.

The default path is `/root/.config/gh/host.yml` — the same file
`gh` itself uses on the manager host.

## Testing

`scripts/test_merge_gate.py` covers the unit-level behaviour with
`unittest.mock` (no network, no PyPI deps beyond `requests` + `pyyaml`
which are already on the host):

```bash
cd scripts && python3 -m unittest test_merge_gate -v
```

Tests cover:

- Token loading from env + flat YAML + nested YAML + missing fields
- SHA mismatch (exit 1)
- CI status not completed (exit 1)
- CI conclusion failure (exit 1)
- Required check missing (exit 1)
- Required check skipped (treated as failure)
- End-to-end happy path through `main()`

## When NOT to use

- For PRs that bypass CI on purpose (e.g. doc-only changes) — the
  `--required-checks` flag lets you trim the required list, but you
  should still pass the same `--sha`.
- For repos where branch protection IS configured — GitHub will
  reject the merge server-side, so the gate is redundant but
  harmless.
