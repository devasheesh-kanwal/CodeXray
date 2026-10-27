"""Eval gate (plain code): the checklist a patch must pass before human review.

The patch passes only if every check passes. No LLM opinion can change this.
"""

import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

from app.agents.tools import MAX_PATCH_LINES, changed_line_count, is_test_path
from app.api.schemas.repair import EvalCheck, EvalResult
from app.repair import git_ops
from app.repair.sandbox import TestRun

HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")
RUFF_TIMEOUT_S = 60


def evaluate(baseline: TestRun, after: TestRun, worktree: Path) -> EvalResult:
    """Run every check on the worktree's current (uncommitted) patch."""
    diff = git_ops.worktree_diff(worktree)
    changed = git_ops.changed_files(worktree)
    return EvalResult(checks=[
        check_target_tests(baseline, after),
        check_no_regressions(baseline, after),
        check_lint(worktree, diff, changed),
        check_no_test_files(changed),
        check_patch_size(diff),
    ])


def passed(result: EvalResult) -> bool:
    return all(check.passed for check in result.checks)


def check_target_tests(baseline: TestRun, after: TestRun) -> EvalCheck:
    name = "target_test_passes"
    if after.error:
        return EvalCheck(name=name, passed=False, detail=f"Tests did not run: {after.error}.")
    still_failing = [t for t in baseline.failed if after.outcomes.get(t) != "passed"]
    if still_failing:
        return EvalCheck(name=name, passed=False,
                         detail=f"{len(still_failing)} of {len(baseline.failed)} target tests still fail "
                                f"or are missing: {', '.join(still_failing[:5])}.")
    return EvalCheck(name=name, passed=True,
                     detail=f"All {len(baseline.failed)} target tests now pass: {', '.join(baseline.failed[:5])}.")


def check_no_regressions(baseline: TestRun, after: TestRun) -> EvalCheck:
    name = "no_regressions"
    if after.error:
        return EvalCheck(name=name, passed=False, detail=f"Tests did not run: {after.error}.")
    broken = [t for t in baseline.passed if after.outcomes.get(t) != "passed"]
    if broken:
        return EvalCheck(name=name, passed=False,
                         detail=f"{len(broken)} tests that passed at baseline now fail or are missing: "
                                f"{', '.join(broken[:5])}.")
    return EvalCheck(name=name, passed=True,
                     detail=f"All tests that passed at baseline still pass ({len(baseline.passed)}).")


def check_no_test_files(changed: list[str]) -> EvalCheck:
    tests = [p for p in changed if is_test_path(p)]
    if tests:
        return EvalCheck(name="no_test_files_changed", passed=False,
                         detail=f"Test files were changed: {', '.join(tests)}.")
    return EvalCheck(name="no_test_files_changed", passed=True,
                     detail=f"The patch changes only {', '.join(changed) or 'nothing'}.")


def check_patch_size(diff: str) -> EvalCheck:
    lines = changed_line_count(diff)
    if lines == 0:
        return EvalCheck(name="patch_size", passed=False, detail="The patch is empty.")
    return EvalCheck(name="patch_size", passed=lines <= MAX_PATCH_LINES,
                     detail=f"{lines} changed lines (limit {MAX_PATCH_LINES}).")


# ---------- lint ----------


def check_lint(worktree: Path, diff: str, changed: list[str]) -> EvalCheck:
    """No new ruff errors on the lines the patch added (ruff's default rules)."""
    name = "lint_clean"
    if importlib.util.find_spec("ruff") is None:
        return EvalCheck(name=name, passed=False, detail="ruff is not installed (pip install ruff).")
    added = added_lines(diff)
    new_errors = []
    for path in changed:
        if not path.endswith(".py") or not (worktree / path).is_file():
            continue
        after = (worktree / path).read_text(encoding="utf-8", errors="replace")
        before = git_ops.show_file(worktree, path) or ""
        after_lines = after.splitlines()
        known = {(code, line) for code, _, line in _ruff(before, path, before.splitlines())}
        for code, row, line in _ruff(after, path, after_lines):
            if row in added.get(path, set()) and (code, line) not in known:
                new_errors.append(f"{path}:{row} {code}")
    if new_errors:
        return EvalCheck(name=name, passed=False,
                         detail=f"ruff reports new issues on changed lines: {', '.join(new_errors[:5])}.")
    return EvalCheck(name=name, passed=True, detail="ruff reports no new issues on changed lines.")


def _ruff(source: str, path: str, lines: list[str]) -> list[tuple[str, int, str]]:
    """[(code, row, stripped source line)] for one file's content."""
    command = [sys.executable, "-m", "ruff", "check", "--isolated", "--output-format", "json",
               "--stdin-filename", path, "-"]
    result = subprocess.run(command, input=source.encode("utf-8"), capture_output=True,
                            timeout=RUFF_TIMEOUT_S)
    if result.returncode not in (0, 1):  # 2 = ruff itself failed
        raise RuntimeError(f"ruff failed: {result.stderr.decode('utf-8', errors='replace')[:200]}")
    errors = []
    for item in json.loads(result.stdout or b"[]"):
        row = item["location"]["row"]
        line = lines[row - 1].strip() if 0 < row <= len(lines) else ""
        errors.append((item.get("code") or "E", row, line))
    return errors


def added_lines(diff: str) -> dict[str, set[int]]:
    """{path: line numbers (in the new file) that the diff adds}."""
    added: dict[str, set[int]] = {}
    path, row = None, 0
    for line in diff.splitlines():
        if line.startswith("+++ "):
            target = line[4:].split("\t")[0].strip()
            path = target[2:] if target.startswith("b/") else None if target == "/dev/null" else target
            continue
        if line.startswith("--- ") or path is None:
            continue
        hunk = HUNK.match(line)
        if hunk:
            row = int(hunk.group(1))
        elif line.startswith("+"):
            added.setdefault(path, set()).add(row)
            row += 1
        elif line.startswith(" "):
            row += 1
    return added
