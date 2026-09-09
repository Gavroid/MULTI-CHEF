"""Unit tests for scripts/merge-gate.py.

We mock `requests.get` and `yaml.safe_load` for token parsing so the suite
runs in <1s with no network and no PyPI deps (just stdlib + requests +
pyyaml, both already available on the manager host).
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import unittest
from unittest.mock import MagicMock, mock_open, patch

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("merge_gate", os.path.join(_HERE, "merge_gate.py"))
assert _spec is not None and _spec.loader is not None
merge_gate = importlib.util.module_from_spec(_spec)
# Register before exec_module so `patch("merge_gate.load_token", ...)`
# can resolve the dotted path. Without this the module lives in a
# throwaway namespace and the dotted patch target doesn't match.
sys.modules.setdefault("merge_gate", merge_gate)
_spec.loader.exec_module(merge_gate)


def fake_response(status_code: int, body: dict | list | None = None) -> MagicMock:
    """Return a mock that quacks like requests.Response enough for our code."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = json.dumps(body) if body is not None else ""
    resp.json.return_value = body if body is not None else {}
    resp.raise_for_status.side_effect = None
    if status_code == 404:
        resp.raise_for_status.side_effect = None  # our code catches 404 before raise_for_status
    elif status_code >= 400:
        resp.raise_for_status.side_effect = Exception(f"HTTP {status_code}")
    return resp


class TokenTests(unittest.TestCase):
    def test_token_from_env(self) -> None:
        with patch.dict(os.environ, {"GITHUB_TOKEN": "ghp_env"}):
            self.assertEqual(merge_gate.load_token(None), "ghp_env")

    def test_token_from_yaml_nested(self) -> None:
        yaml_data = {"github.com": {"oauth_token": "ghp_nested", "user": "x"}}
        with patch("builtins.open", mock_open(read_data="")):
            with patch("merge_gate.yaml.safe_load", return_value=yaml_data):
                self.assertEqual(merge_gate.load_token("/tmp/gh.yml"), "ghp_nested")

    def test_token_from_yaml_flat(self) -> None:
        with patch("builtins.open", mock_open(read_data="")):
            with patch("merge_gate.yaml.safe_load", return_value={"oauth_token": "ghp_flat"}):
                self.assertEqual(merge_gate.load_token("/tmp/gh.yml"), "ghp_flat")

    def test_token_missing_yaml_field(self) -> None:
        with patch("builtins.open", mock_open(read_data="")):
            with patch("merge_gate.yaml.safe_load", return_value={"github.com": {"user": "x"}}):
                with self.assertRaises(SystemExit) as ctx:
                    merge_gate.load_token("/tmp/gh.yml")
                self.assertEqual(ctx.exception.code, 2)

    def test_token_missing_everywhere(self) -> None:
        env = {k: v for k, v in os.environ.items() if k not in {"GITHUB_TOKEN", "GH_TOKEN"}}
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(SystemExit) as ctx:
                merge_gate.load_token(None)
            self.assertEqual(ctx.exception.code, 2)


class ShaTests(unittest.TestCase):
    def test_sha_mismatch_exits_1(self) -> None:
        pr_body = {"head": {"sha": "actual_sha_xyz"}}
        headers = merge_gate.github_headers("tok")
        with patch("merge_gate.requests.get", return_value=fake_response(200, pr_body)):
            with self.assertRaises(SystemExit) as ctx:
                merge_gate.verify_head_sha(17, "expected_sha_abc", "owner/repo", headers)
            self.assertEqual(ctx.exception.code, 1)

    def test_sha_match_returns_actual(self) -> None:
        sha = "abc123"
        pr_body = {"head": {"sha": sha}}
        headers = merge_gate.github_headers("tok")
        with patch("merge_gate.requests.get", return_value=fake_response(200, pr_body)):
            actual = merge_gate.verify_head_sha(17, sha, "owner/repo", headers)
        self.assertEqual(actual, sha)


class CiRunTests(unittest.TestCase):
    def test_no_runs_exits_1(self) -> None:
        with patch(
            "merge_gate.requests.get", return_value=fake_response(200, {"workflow_runs": []})
        ):
            run = merge_gate.fetch_ci_run("sha", "owner/repo", {})
            self.assertEqual(run, {})
            with self.assertRaises(SystemExit) as ctx:
                merge_gate.verify_run_completed(run)
            self.assertEqual(ctx.exception.code, 1)

    def test_run_in_progress_exits_1(self) -> None:
        run = {"id": 99, "status": "in_progress", "conclusion": None}
        with self.assertRaises(SystemExit) as ctx:
            merge_gate.verify_run_completed(run)
        self.assertEqual(ctx.exception.code, 1)

    def test_run_failed_exits_1(self) -> None:
        run = {"id": 99, "status": "completed", "conclusion": "failure"}
        with self.assertRaises(SystemExit) as ctx:
            merge_gate.verify_run_completed(run)
        self.assertEqual(ctx.exception.code, 1)

    def test_run_success_passes(self) -> None:
        run = {"id": 99, "status": "completed", "conclusion": "success"}
        try:
            merge_gate.verify_run_completed(run)
        except SystemExit as exc:  # pragma: no cover
            self.fail(f"unexpected exit: {exc.code}")


class RequiredCheckTests(unittest.TestCase):
    REQUIRED = ("lint", "typecheck", "test", "build", "secret-scan")

    def _job(self, name: str, conclusion: str = "success") -> dict:
        return {"name": name, "conclusion": conclusion}

    def test_all_passed(self) -> None:
        jobs = {n: self._job(n) for n in self.REQUIRED}
        try:
            merge_gate.verify_required_checks(jobs, self.REQUIRED)
        except SystemExit as exc:  # pragma: no cover
            self.fail(f"unexpected exit: {exc.code}")

    def test_missing_required_check_exits_1(self) -> None:
        jobs = {n: self._job(n) for n in self.REQUIRED if n != "lint"}
        with self.assertRaises(SystemExit) as ctx:
            merge_gate.verify_required_checks(jobs, self.REQUIRED)
        self.assertEqual(ctx.exception.code, 1)

    def test_failed_required_check_exits_1(self) -> None:
        jobs = {n: self._job(n) for n in self.REQUIRED}
        jobs["test"] = self._job("test", conclusion="failure")
        with self.assertRaises(SystemExit) as ctx:
            merge_gate.verify_required_checks(jobs, self.REQUIRED)
        self.assertEqual(ctx.exception.code, 1)

    def test_skipped_job_treated_as_failure(self) -> None:
        # GitHub uses 'skipped' for jobs that didn't run. Be strict.
        jobs = {n: self._job(n) for n in self.REQUIRED}
        jobs["build"] = self._job("build", conclusion="skipped")
        with self.assertRaises(SystemExit) as ctx:
            merge_gate.verify_required_checks(jobs, self.REQUIRED)
        self.assertEqual(ctx.exception.code, 1)


class HappyPathTest(unittest.TestCase):
    """Wire the whole script end-to-end with mocked HTTP."""

    SHA = "deadbeef1234"
    PR = 42

    def _ok(self, *calls: tuple[str, dict | list]) -> None:
        """Build a side_effect function that dispatches per URL path."""
        # Sort longest needle first so e.g. '/actions/runs/7/jobs' wins
        # over '/actions/runs' when both substrings appear in the URL.
        self._urls = sorted([c[0] for c in calls], key=len, reverse=True)
        self._bodies = dict(calls)

        def side_effect(url: str, headers=None, params=None, timeout=None):  # noqa: ARG001
            for needle in self._urls:
                if needle in url:
                    body = self._bodies[needle]
                    return fake_response(200, body)
            self.fail(f"unexpected URL in test: {url}")

        self._side_effect = side_effect

    def test_main_happy_path_exits_0(self) -> None:
        pr_body = {
            "head": {"sha": self.SHA},
            "html_url": "https://github.com/owner/repo/pull/42",
        }
        run = {
            "id": 7,
            "run_number": 17,
            "name": "CI",
            "status": "completed",
            "conclusion": "success",
            "html_url": "https://github.com/owner/repo/actions/runs/7",
        }
        jobs = [
            {"name": name, "conclusion": "success"}
            for name in ("lint", "typecheck", "test", "build", "secret-scan")
        ]
        self._ok(
            ("/pulls/42", pr_body),
            ("/actions/runs", {"workflow_runs": [run]}),
            ("/actions/runs/7/jobs", {"jobs": jobs}),
        )
        with patch("merge_gate.requests.get", side_effect=self._side_effect), patch(
            "merge_gate.load_token", return_value="stub-token"
        ):
            rc = merge_gate.main(["--pr", str(self.PR), "--sha", self.SHA, "--repo", "owner/repo"])
        self.assertEqual(rc, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
