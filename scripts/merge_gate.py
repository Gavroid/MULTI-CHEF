#!/usr/bin/env python3
"""merge-gate — GitHub merge-gate that blocks squash-merge unless CI is green
on the exact head-SHA the manager intends to merge.

# Why

Branch protection on free-tier GitHub private repos is not enforceable via
API — anyone with write access can call `PUT /repos/{repo}/pulls/{n}/merge`
with an arbitrary `sha` parameter. That creates a race condition:

    1. Manager opens PR at head-SHA abc123, CI goes green
    2. Author pushes a new commit, head-SHA becomes def456
    3. Manager runs `gh pr merge --squash --sha abc123`
    4. def456 lands on main, bypassing CI

# What this script does

Before letting the manager run the merge API call, we re-verify the world:

    1. PR head-SHA == the SHA the manager passed in (race detector).
    2. The Actions run on that exact SHA has status=completed,
       conclusion=success.
    3. Every required CI job is present and successful.

# Usage

    python3 scripts/merge-gate.py \\
        --pr 17 --sha abc123def456... \\
        --repo Gavroid/MULTI-CHEF \\
        --token-file /root/.config/gh/host.yml

Exit codes:
    0 — merge-gate passed, safe to squash-merge
    1 — merge-gate failed, DO NOT merge (see stderr for reason)
    2 — operator error (missing token, bad args)
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Any

import requests
import yaml

GITHUB_API = "https://api.github.com"
DEFAULT_REQUIRED_CHECKS = ("lint", "typecheck", "test", "build", "secret-scan")
REQUEST_TIMEOUT = 15  # seconds


def load_token(token_file: str | None) -> str:
    """Pull an oauth token from --token-file (YAML) or GITHUB_TOKEN env."""
    if token_file:
        try:
            with open(token_file, encoding="utf-8") as fh:
                data = yaml.safe_load(fh) or {}
        except OSError as exc:
            print(f"ERROR: cannot read token file {token_file}: {exc}", file=sys.stderr)
            sys.exit(2)
        except yaml.YAMLError as exc:
            print(f"ERROR: token file {token_file} is not valid YAML: {exc}", file=sys.stderr)
            sys.exit(2)
        # `gh auth login` writes host.yml as { "github.com": { oauth_token: …,
        # user: … } }. We accept both that layout and a flat {oauth_token: …}.
        token = (
            (data.get("github.com") or {}).get("oauth_token")
            or data.get("oauth_token")
            or data.get("token")
        )
        if not token:
            print(
                f"ERROR: oauth_token not found in {token_file} (expected top-level "
                "or under 'github.com')",
                file=sys.stderr,
            )
            sys.exit(2)
        return token
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not token:
        print(
            "ERROR: GITHUB_TOKEN env var or --token-file required",
            file=sys.stderr,
        )
        sys.exit(2)
    return token


def github_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "multichef-merge-gate/1.0",
    }


def _api_get(url: str, headers: dict[str, str], **params: Any) -> dict[str, Any]:
    """GET with retry on transient 5xx; raises on 4xx so caller sees a clear error."""
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            resp = requests.get(url, headers=headers, params=params, timeout=REQUEST_TIMEOUT)
        except requests.RequestException as exc:
            last_err = exc
            time.sleep(0.5 * (attempt + 1))
            continue
        if resp.status_code >= 500:
            last_err = RuntimeError(f"GitHub 5xx: {resp.status_code} {resp.text[:200]}")
            time.sleep(0.5 * (attempt + 1))
            continue
        if resp.status_code == 404:
            raise SystemExit(f"ERROR: 404 from {url} — check --repo / --pr")
        if resp.status_code == 401:
            raise SystemExit("ERROR: 401 Unauthorized — check token scope (repo)")
        resp.raise_for_status()
        return resp.json()
    raise SystemExit(f"ERROR: GitHub API unreachable after 3 attempts: {last_err}")


def verify_head_sha(pr: int, expected_sha: str, repo: str, headers: dict[str, str]) -> str:
    """Return the actual head SHA; abort if it no longer matches expected_sha."""
    data = _api_get(f"{GITHUB_API}/repos/{repo}/pulls/{pr}", headers)
    actual = data.get("head", {}).get("sha", "")
    if not actual:
        raise SystemExit(f"ERROR: PR #{pr} response missing head.sha — API shape changed?")
    if actual != expected_sha:
        print("❌ MERGE-GATE FAILED: head-SHA mismatch (race condition).", file=sys.stderr)
        print(f"   Expected: {expected_sha}", file=sys.stderr)
        print(f"   Actual:   {actual}", file=sys.stderr)
        print(
            "   The PR was updated after CI last ran on the expected SHA. "
            "Re-run CI on the new SHA before retrying.",
            file=sys.stderr,
        )
        sys.exit(1)
    return actual


def fetch_ci_run(sha: str, repo: str, headers: dict[str, str]) -> dict[str, Any]:
    """Return the most recent Actions workflow_run for the given SHA, or None."""
    data = _api_get(
        f"{GITHUB_API}/repos/{repo}/actions/runs",
        headers,
        head_sha=sha,
        per_page=1,
    )
    runs = data.get("workflow_runs") or []
    return runs[0] if runs else {}


def verify_run_completed(run: dict[str, Any]) -> None:
    status = run.get("status")
    conclusion = run.get("conclusion")
    run_id = run.get("id", "?")
    if not run:
        print(
            "❌ MERGE-GATE FAILED: no CI workflow run found for the given SHA.",
            file=sys.stderr,
        )
        sys.exit(1)
    if status != "completed":
        print(
            f"❌ MERGE-GATE FAILED: CI run #{run_id} status={status!r} "
            "(not yet completed).",
            file=sys.stderr,
        )
        sys.exit(1)
    if conclusion != "success":
        print(
            f"❌ MERGE-GATE FAILED: CI run #{run_id} conclusion={conclusion!r} "
            f"(html_url={run.get('html_url', '?')}).",
            file=sys.stderr,
        )
        sys.exit(1)


def fetch_jobs(run_id: int | str, repo: str, headers: dict[str, str]) -> dict[str, dict[str, Any]]:
    data = _api_get(f"{GITHUB_API}/repos/{repo}/actions/runs/{run_id}/jobs", headers)
    return {job["name"]: job for job in (data.get("jobs") or [])}


def verify_required_checks(jobs: dict[str, dict[str, Any]], required: tuple[str, ...]) -> None:
    missing = [c for c in required if c not in jobs]
    failed = [
        f"{c}={jobs[c].get('conclusion')!r}"
        for c in required
        if c in jobs and jobs[c].get("conclusion") != "success"
    ]
    if missing or failed:
        print(
            "❌ MERGE-GATE FAILED: required checks did not all pass.",
            file=sys.stderr,
        )
        if missing:
            print(f"   Missing jobs: {missing}", file=sys.stderr)
        if failed:
            print(f"   Failed jobs:  {failed}", file=sys.stderr)
        sys.exit(1)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="merge-gate",
        description=(
            "GitHub merge-gate: verify CI is green on the exact head-SHA "
            "before squash-merging. Exits 0 on pass, 1 on fail, 2 on operator error."
        ),
    )
    parser.add_argument("--pr", type=int, required=True, help="PR number")
    parser.add_argument(
        "--sha",
        required=True,
        help="Expected head SHA — the SHA CI last tested. Must match GitHub's view of the PR.",
    )
    parser.add_argument("--repo", default="Gavroid/MULTI-CHEF", help="owner/repo")
    parser.add_argument(
        "--token-file",
        help="Path to gh host.yml (yaml with oauth_token). Defaults to $GITHUB_TOKEN.",
    )
    parser.add_argument(
        "--required-checks",
        nargs="*",
        default=list(DEFAULT_REQUIRED_CHECKS),
        metavar="JOB",
        help=(
            "CI job names that must all be present and successful. "
            f"Default: {' '.join(DEFAULT_REQUIRED_CHECKS)}"
        ),
    )
    args = parser.parse_args(argv)

    token = load_token(args.token_file)
    headers = github_headers(token)

    actual_sha = verify_head_sha(args.pr, args.sha, args.repo, headers)

    run = fetch_ci_run(args.sha, args.repo, headers)
    verify_run_completed(run)

    jobs = fetch_jobs(run["id"], args.repo, headers)
    verify_required_checks(jobs, tuple(args.required_checks))

    short_sha = actual_sha[:12]
    print(f"✅ MERGE-GATE PASSED for PR #{args.pr} sha={short_sha}")
    print(
        f"   CI run #{run.get('run_number', '?')} ({run.get('name', '?')}): "
        f"{run.get('conclusion')}"
    )
    print(f"   All {len(args.required_checks)} required checks: success")
    return 0


if __name__ == "__main__":
    sys.exit(main())
