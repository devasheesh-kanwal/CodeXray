"""The repair endpoints over HTTP, plus the sandbox and eval-gate helpers."""

import asyncio
import hashlib
import json
import subprocess
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agents.state import RunState
from app.agents.tools import TestFileArgs, ToolContext, ToolError, write_test
from app.main import create_app
from app.repair.eval_gate import added_lines, check_lint, check_repro_unchanged
from app.repair.sandbox import (
    Sandbox,
    TestRun,
    clean_env,
    junit_test_id,
    merge_runs,
    pytest_args,
    read_junit,
    read_junit_details,
)
from app.repair.workflow import repro_problem
from tests.conftest import make_settings
from tests.repair.conftest import FIX, ISSUE, make_kit
from tests.repair.test_workflow import script_success


def sse_events(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.strip().split("\n\n"):
        name, data = block.split("\n", 1)
        events.append((name.removeprefix("event: "), json.loads(data.removeprefix("data: "))))
    return events


def test_repair_over_http(tmp_path):
    kit = make_kit(tmp_path)
    script_success(kit)
    app = create_app(make_settings(tmp_path / "app", mock_mode=False))
    app.state.repair_service = kit.service
    with TestClient(app) as client:
        resp = client.post(f"/api/repos/{kit.repo_id}/repair", json={"issue": ISSUE})
        assert resp.status_code == 202
        run_id = resp.json()["run_id"]

        second = client.post(f"/api/repos/{kit.repo_id}/repair", json={"issue": ISSUE})
        assert second.status_code == 409
        assert second.json()["error"]["code"] == "INVALID_STATE"

        deadline = time.monotonic() + 120
        while (run := client.get(f"/api/repairs/{run_id}").json())["state"] not in (
                "AWAITING_APPROVAL", "FAILED"):
            assert time.monotonic() < deadline, run["state"]
            time.sleep(0.2)
        assert run["state"] == "AWAITING_APPROVAL" and "ranked[:n]" in run["diff"]

        events = sse_events(client.get(f"/api/repairs/{run_id}/events").text)
        assert events[0][0] == "repair_event" and events[0][1]["state"] == "CREATED"
        assert events[0][1]["data"]["issue"] == ISSUE
        assert events[-1] == ("done", {"state": "AWAITING_APPROVAL"})
        kinds = {data["kind"] for name, data in events if name == "repair_event"}
        assert kinds >= {"state", "agent", "tests", "eval", "note"}

        assert client.post(f"/api/repairs/{run_id}/approve").json()["state"] == "MERGED"
        assert client.post(f"/api/repairs/{run_id}/reject").status_code == 409


def test_bad_test_command_is_422_over_http(tmp_path):
    kit = make_kit(tmp_path)
    app = create_app(make_settings(tmp_path / "app", mock_mode=False))
    app.state.repair_service = kit.service
    resp = TestClient(app).post(f"/api/repos/{kit.repo_id}/repair",
                                json={"issue": "x", "test_command": "bash -c 'curl evil'"})
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "VALIDATION_ERROR"


# ---------- sandbox ----------


def test_pytest_args():
    assert pytest_args(None) == ["-q"]
    assert pytest_args("pytest tests/test_x.py -k fast") == ["tests/test_x.py", "-k", "fast"]
    assert pytest_args("python -m pytest") == []


def test_docker_command_blocks_network_and_limits_resources(tmp_path):
    command = Sandbox(timeout_s=90, image="img").docker_command(tmp_path / "wt", tmp_path / "res", "a1", ["-q"])
    joined = " ".join(command)
    assert command[:3] == ["docker", "run", "--rm"]
    assert "--network none" in joined and "--memory 512m" in joined and "--cpus 1" in joined
    assert f"{(tmp_path / 'wt').resolve()}:/repo:ro" in command
    assert "timeout 90 python -m pytest -q" in joined and "--junitxml=/results/a1.xml" in joined


def test_clean_env_drops_secrets(monkeypatch, tmp_path):
    monkeypatch.setenv("GROQ_API_KEYS", "gsk_secret")
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_secret")
    env = clean_env(tmp_path)
    assert "GROQ_API_KEYS" not in env and "GITHUB_TOKEN" not in env
    assert env["PYTHONDONTWRITEBYTECODE"] == "1"


def test_read_junit(tmp_path):
    report = tmp_path / "r.xml"
    report.write_text(
        '<testsuites><testsuite>'
        '<testcase classname="tests.test_a" name="test_ok" file="tests/test_a.py"/>'
        '<testcase classname="tests.test_a.TestB" name="test_bad" file="tests/test_a.py">'
        '<failure message="x"/></testcase>'
        '<testcase classname="tests.test_a" name="test_skip" file="tests/test_a.py"><skipped/></testcase>'
        '</testsuite></testsuites>')
    assert read_junit(report) == {
        "tests/test_a.py::test_ok": "passed",
        "tests/test_a.py::TestB::test_bad": "failed",
        "tests/test_a.py::test_skip": "skipped",
    }
    assert read_junit(tmp_path / "missing.xml") == {}
    assert junit_test_id(None, "mod", "t") == "mod::t"


# ---------- eval gate ----------


def test_added_lines_are_new_file_line_numbers():
    assert added_lines(FIX) == {"inventory/stock.py": {7}}


def test_lint_check_flags_new_errors_only(tmp_path):
    repo = tmp_path / "r"
    repo.mkdir()
    (repo / "m.py").write_text("import os\n\n\ndef f():\n    return 1\n")  # F401 already there
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "i"], cwd=repo, check=True)
    (repo / "m.py").write_text("import os\n\n\ndef f():\n    return undefined_name\n")
    diff = ("--- a/m.py\n+++ b/m.py\n@@ -4,2 +4,2 @@\n def f():\n-    return 1\n"
            "+    return undefined_name\n")
    result = check_lint(Path(repo), diff, ["m.py"])
    assert not result.passed and "m.py:5 F821" in result.detail and "F401" not in result.detail


# ---------- reproduction tests ----------


def test_read_junit_details_separates_errors_and_keeps_the_exception_line(tmp_path):
    report = tmp_path / "r.xml"
    report.write_text(
        '<testsuites><testsuite>'
        '<testcase classname="test_r" name="test_bug" file="test_r.py">'
        '<failure message="assert 1 == 2">def test_bug():\nE   assert 1 == 2</failure></testcase>'
        '<testcase classname="" name="test_x">'
        '<error message="collection failure">import nope\nE   ModuleNotFoundError: No module named \'nope\''
        '</error></testcase>'
        '</testsuite></testsuites>')
    outcomes, errored, messages = read_junit_details(report)
    assert outcomes == {"test_r.py::test_bug": "failed", "::test_x": "failed"}
    assert errored == ["::test_x"]
    assert messages["test_r.py::test_bug"] == "assert 1 == 2"
    assert messages["::test_x"] == "ModuleNotFoundError: No module named 'nope'"


def test_merge_runs_ignores_a_suite_that_collected_nothing():
    suite = TestRun(sandbox="subprocess", exit_code=5, error="no test results (pytest exit code 5)")
    repro = TestRun(sandbox="subprocess", outcomes={"test_r.py::test_bug": "passed"})
    merged = merge_runs(suite, repro)
    assert merged.error is None and merged.passed == ["test_r.py::test_bug"]


@pytest.mark.parametrize(("run", "expected"), [
    (TestRun(sandbox="subprocess", outcomes={"t::a": "passed"}), "passed on the unpatched code"),
    (TestRun(sandbox="subprocess", outcomes={"t::a": "failed"}, errored=["t::a"], messages={"t::a": "boom"}),
     "errored instead of failing an assertion: boom"),
    (TestRun(sandbox="subprocess", outcomes={"t::a": "failed"},
             messages={"t::a": "ModuleNotFoundError: No module named 'flask'"}), "unrelated to the bug"),
    (TestRun(sandbox="subprocess", error="timed out after 60 s"), "could not run"),
], ids=["passes", "errors", "import-error", "timeout"])
def test_repro_problem_refuses_tests_that_do_not_show_the_bug(run, expected):
    assert expected in repro_problem(run)


def test_repro_problem_accepts_an_assertion_failure():
    run = TestRun(sandbox="subprocess", outcomes={"t::a": "failed"}, messages={"t::a": "assert [1] == [1, 2]"})
    assert repro_problem(run) is None


def write_ctx(tmp_path, test_file="test_repro.py") -> ToolContext:
    root = tmp_path / "worktrees"
    (root / "run_1").mkdir(parents=True)
    state = RunState(run_id="run_1", workflow="repair", repo_id="r", inputs={})
    return ToolContext(index=None, repo_id="r", state=state, worktree=root / "run_1",
                       worktrees_root=root, test_file=test_file)


def test_write_test_writes_only_the_fixed_file(tmp_path):
    ctx = write_ctx(tmp_path)
    write_test(ctx, TestFileArgs(code="def test_a():\n    assert 1 == 2"))
    written = ctx.worktree / "test_repro.py"
    assert written.read_bytes() == b"def test_a():\n    assert 1 == 2\n"
    assert ctx.state.artifacts["repro_code"].startswith("def test_a")


@pytest.mark.parametrize(("code", "error"), [
    ("def test_a(:\n", "not valid Python"),
    ("def helper():\n    pass\n", "no test function"),
    ("x = 1\n" * 5000, "too long"),
], ids=["syntax", "no-test", "too-long"])
def test_write_test_refuses_bad_files(tmp_path, code, error):
    with pytest.raises(ToolError, match=error):
        write_test(write_ctx(tmp_path), TestFileArgs(code=code))


def test_write_test_needs_a_repair_run(tmp_path):
    ctx = write_ctx(tmp_path, test_file=None)
    with pytest.raises(ToolError, match="only works"):
        write_test(ctx, TestFileArgs(code="def test_a():\n    pass\n"))


def test_repro_test_unchanged_compares_bytes(tmp_path):
    original = b"def test_a():\n    assert 0\n"
    (tmp_path / "test_r.py").write_bytes(original)
    repro = {"path": "test_r.py", "sha256": hashlib.sha256(original).hexdigest()}
    assert check_repro_unchanged(tmp_path, repro).passed
    (tmp_path / "test_r.py").write_bytes(b"def test_a():\n    assert 1\n")
    assert not check_repro_unchanged(tmp_path, repro).passed
    (tmp_path / "test_r.py").unlink()
    assert "deleted" in check_repro_unchanged(tmp_path, repro).detail



def test_sandbox_never_uses_codexrays_own_pytest_config(tmp_path):
    """A repo without pytest config, inside a folder whose parent has one, runs on its own."""
    parent = tmp_path / "codexray_like"
    repo = parent / "data" / "repo"
    repo.mkdir(parents=True)
    (parent / "pytest.ini").write_text("[pytest]\npythonpath = .\naddopts = --strict-unknown-flag\n")
    (repo / "test_alone.py").write_text("def test_ok():\n    assert True\n")
    run = asyncio.run(Sandbox(timeout_s=60, use_docker=False).run(repo, None, tmp_path / "res", "iso"))
    assert run.error is None, run.output
    assert run.outcomes == {"test_alone.py::test_ok": "passed"}  # id relative to the repo, not the parent
