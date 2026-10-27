"""Test runner sandbox: runs the repo's pytest command and reads per-test results.

Docker when available: the worktree is mounted read-only, no network, CPU,
memory and process limits, and a timeout. Otherwise a plain subprocess with a
timeout and an environment without secrets. That is weaker: the tests can
reach the network and the file system, so the workflow emits a warning.

Per-test results come from pytest's JUnit XML report (written outside the
worktree), so test commands must run pytest.
"""

import asyncio
import os
import re
import shlex
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

DEFAULT_TEST_COMMAND = "python -m pytest -q"
OUTPUT_CHARS = 6000  # tail of the test output kept for the agents
SECRET_ENV = re.compile(r"KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL", re.IGNORECASE)
DOCKER_LIMITS = ["--network", "none", "--cpus", "1", "--memory", "512m", "--pids-limit", "256"]

SandboxKind = Literal["docker", "subprocess"]


class BadTestCommand(ValueError):
    """The test command is not a pytest command."""


@dataclass
class TestRun:
    __test__ = False  # not a pytest test class

    sandbox: SandboxKind
    outcomes: dict[str, str] = field(default_factory=dict)  # test id -> passed/failed/skipped
    exit_code: int | None = None
    timed_out: bool = False
    output: str = ""
    error: str | None = None  # set when no per-test results could be read
    errored: list[str] = field(default_factory=list)  # failed with an error, not an assertion
    messages: dict[str, str] = field(default_factory=dict)  # test id -> failure message

    @property
    def no_tests(self) -> bool:
        """pytest collected nothing (exit code 5), e.g. a repo without tests."""
        return not self.outcomes and self.exit_code == 5

    @property
    def passed(self) -> list[str]:
        return [t for t, o in self.outcomes.items() if o == "passed"]

    @property
    def failed(self) -> list[str]:
        return [t for t, o in self.outcomes.items() if o == "failed"]

    def summary(self) -> str:
        if self.error:
            return f"tests could not run: {self.error}"
        return f"{len(self.passed)} passed, {len(self.failed)} failed"


def merge_runs(suite: TestRun, repro: TestRun) -> TestRun:
    """The repo's own test run plus the reproduction test's run, as one result.

    A suite that collected nothing (a repo whose only test is the reproduction
    test) is not an error.
    """
    suite_error = None if suite.no_tests else suite.error
    return TestRun(
        sandbox=suite.sandbox,
        outcomes={**suite.outcomes, **repro.outcomes},
        exit_code=suite.exit_code,
        timed_out=suite.timed_out or repro.timed_out,
        output=f"{suite.output}\n{repro.output}".strip(),
        error=suite_error or repro.error,
        errored=suite.errored + [t for t in repro.errored if t not in suite.errored],
        messages={**suite.messages, **repro.messages},
    )


def pytest_args(test_command: str | None) -> list[str]:
    """The pytest arguments of a command like 'pytest tests/x.py' or 'python -m pytest -q'."""
    words = shlex.split(test_command or DEFAULT_TEST_COMMAND)
    if words[:1] == ["pytest"]:
        return words[1:]
    if words[:3] in (["python", "-m", "pytest"], ["python3", "-m", "pytest"]):
        return words[3:]
    raise BadTestCommand("test_command must run pytest, e.g. 'pytest tests/' or 'python -m pytest -q'")


# Added to every run: a JUnit report for per-test results, and no .pytest_cache in the repo.
def _report_args(report: str) -> list[str]:
    return [f"--junitxml={report}", "-o", "junit_family=xunit1", "-p", "no:cacheprovider"]


class Sandbox:
    def __init__(self, timeout_s: float = 120, image: str = "codexray-sandbox:latest",
                 use_docker: bool | None = None) -> None:
        self.timeout_s = timeout_s
        self.image = image
        self._use_docker = use_docker  # None = detect

    @property
    def kind(self) -> SandboxKind:
        if self._use_docker is None:
            self._use_docker = docker_available()
        return "docker" if self._use_docker else "subprocess"

    async def run(self, cwd: Path, test_command: str | None, results_dir: Path, label: str) -> TestRun:
        """Run the tests in cwd; the JUnit report goes to results_dir/<label>.xml."""
        args = pytest_args(test_command)
        results_dir.mkdir(parents=True, exist_ok=True)
        report = results_dir / f"{label}.xml"
        report.unlink(missing_ok=True)
        if self.kind == "docker":
            command, env = self.docker_command(cwd, results_dir, label, args), None
        else:
            command = [sys.executable, "-m", "pytest", *args, *_report_args(str(report)),
                       *isolation_args(cwd, results_dir)]
            env = clean_env(cwd)
        run = TestRun(sandbox=self.kind)
        try:
            result = await asyncio.to_thread(
                subprocess.run, command, cwd=cwd, env=env, capture_output=True,
                timeout=self.timeout_s,
            )
            run.exit_code = result.returncode
            run.output = _tail(result.stdout + result.stderr)
        except subprocess.TimeoutExpired as exc:
            run.timed_out = True
            run.output = _tail((exc.stdout or b"") + (exc.stderr or b""))
            run.error = f"timed out after {self.timeout_s:.0f} s"
            return run
        run.outcomes, run.errored, run.messages = read_junit_details(report)
        if not run.outcomes:
            run.error = f"no test results (pytest exit code {run.exit_code})"
        return run

    def docker_command(self, cwd: Path, results_dir: Path, label: str, args: list[str]) -> list[str]:
        timeout = str(int(self.timeout_s))
        return [
            "docker", "run", "--rm", *DOCKER_LIMITS,
            "-e", "PYTHONDONTWRITEBYTECODE=1", "-e", "PYTHONPATH=/repo",
            "-v", f"{cwd.resolve()}:/repo:ro", "-v", f"{results_dir.resolve()}:/results",
            "-w", "/repo", self.image,
            "timeout", timeout, "python", "-m", "pytest", *args, *_report_args(f"/results/{label}.xml"),
        ]


def docker_available() -> bool:
    """True if the docker CLI exists and its daemon answers."""
    if shutil.which("docker") is None:
        return False
    try:
        return subprocess.run(["docker", "info"], capture_output=True, timeout=15).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def own_pytest_config(cwd: Path) -> Path | None:
    """The repo's own pytest config file at its root, if it has one."""
    markers = {"pytest.ini": "", "pyproject.toml": "[tool.pytest", "tox.ini": "[pytest]",
               "setup.cfg": "[tool:pytest]"}
    for name, marker in markers.items():
        file = cwd / name
        if file.is_file() and marker in file.read_text(encoding="utf-8", errors="replace"):
            return file
    return None


def isolation_args(cwd: Path, results_dir: Path) -> list[str]:
    """Keep pytest inside the repo (subprocess sandbox only).

    Without this, a repo with no pytest config of its own (cloned repos and repair
    worktrees live under CodeXray's data folder) picks up CodeXray's own
    pytest.ini from a parent folder, including its pythonpath, so the repo's
    tests could import CodeXray's code instead of the repo's.
    """
    config = own_pytest_config(cwd)
    if config is None:
        config = results_dir / "pytest.ini"
        config.write_text("[pytest]\n", encoding="utf-8")
    return ["-c", str(config), f"--rootdir={cwd}", f"--confcutdir={cwd}"]


def clean_env(cwd: Path) -> dict[str, str]:
    """os.environ without anything that looks like a secret, for the subprocess fallback."""
    env = {k: v for k, v in os.environ.items() if not SECRET_ENV.search(k)}
    env["PYTHONDONTWRITEBYTECODE"] = "1"  # no __pycache__ in the worktree
    env["PYTHONPATH"] = str(cwd)
    return env


def read_junit(report: Path) -> dict[str, str]:
    """{test id: outcome} from a pytest JUnit XML (xunit1) report, or {} if missing."""
    return read_junit_details(report)[0]


def read_junit_details(report: Path) -> tuple[dict[str, str], list[str], dict[str, str]]:
    """(outcomes, errored test ids, {test id: failure or error message}) from a JUnit report.

    An error (collection, import, fixture) counts as "failed" in outcomes, but is
    also listed in errored: only a real assertion failure reproduces a bug.
    """
    if not report.is_file():
        return {}, [], {}
    try:
        root = ET.parse(report).getroot()
    except ET.ParseError:
        return {}, [], {}
    outcomes, errored, messages = {}, [], {}
    for case in root.iter("testcase"):
        test_id = junit_test_id(case.get("file"), case.get("classname", ""), case.get("name", ""))
        failure, error = case.find("failure"), case.find("error")
        outcome = "passed"
        if failure is not None or error is not None:
            outcome = "failed"
            problem = error if error is not None else failure
            messages[test_id] = failure_message(problem.get("message") or "", problem.text or "")
            if error is not None:
                errored.append(test_id)
        elif case.find("skipped") is not None:
            outcome = "skipped"
        outcomes[test_id] = outcome
    return outcomes, errored, messages


def failure_message(message: str, text: str) -> str:
    """The exception line of a failure ('E   ValueError: ...'), else pytest's message.

    For a collection error pytest's message is only "collection failure"; the
    real cause (e.g. ModuleNotFoundError) is on the first 'E' line of the text.
    """
    for line in text.splitlines():
        if line.startswith("E "):
            return line[1:].strip()[:300]
    return message.strip()[:300]


def junit_test_id(file: str | None, classname: str, name: str) -> str:
    """'tests/test_x.py::TestY::test_z' from a JUnit testcase's attributes."""
    if not file:
        return f"{classname}::{name}"
    file = file.replace("\\", "/")
    module = file.removesuffix(".py").replace("/", ".")
    rest = classname[len(module) + 1:] if classname.startswith(module + ".") else ""
    return "::".join(part for part in (file, rest, name) if part)


def _tail(data: bytes) -> str:
    text = data.decode("utf-8", errors="replace")
    return text if len(text) <= OUTPUT_CHARS else "[earlier output cut]\n" + text[-OUTPUT_CHARS:]
