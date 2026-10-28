"""The repair workflow: a state machine run by the Coordinator.

CREATED -> BASELINE -> PLANNING -> BRANCHED -> DIAGNOSING -> PATCHING ->
TESTING -> EVALUATING -> REVIEWING -> AWAITING_APPROVAL
A failed attempt goes to CLEANUP (failure note, branch deleted, fresh branch)
and back to DIAGNOSING with attempt + 1. After MAX_ATTEMPTS: FAILED.
MERGED and REJECTED come later, from the human (see service.py).

When no test fails at BASELINE (no tests, or all pass), BRANCHED goes to
REPRODUCING first: the Test writer writes one reproduction test, and plain code
accepts it only if it FAILS on the unpatched code with an assertion (not an
import or collection error). The accepted test is committed on the fix branch,
so every attempt's worktree has the identical, frozen test.

LLM agents suggest (Architect, Test writer, Debugger, Repair, Reviewer, Summarizer);
plain code decides (Test runner, Eval gate, this Coordinator). The Reviewer only
runs after the eval gate passed, so its opinion can never turn a failure into a pass.
An independent review is required: if the Reviewer cannot answer, the run fails.
"""

import asyncio
import hashlib
import time
from pathlib import Path

from app.agents.base import AgentError
from app.agents.coordinator import Workflow
from app.agents.roster import (
    Debugger,
    DebuggerInput,
    Repair,
    RepairInput,
    Reviewer,
    ReviewerInput,
    Summarizer,
    SummarizerInput,
    TestWriter,
    TestWriterInput,
)
from app.agents.state import Budget, BudgetExceeded, RunState
from app.agents.tools import ToolContext, ToolRegistry, default_registry, is_test_path
from app.api.schemas.repair import EvalResult
from app.config import Settings
from app.indexing.service import IndexService
from app.llm import DemoCacheMiss, LLMError, LLMRouter
from app.llm.router import is_excluded
from app.repair import eval_gate, git_ops
from app.repair.agents import MAX_FILES, RepairArchitect, RepairArchitectInput
from app.repair.sandbox import Sandbox, TestRun, merge_runs

MAX_ATTEMPTS = 3
MAX_REPRO_TRIES = 2  # the Test writer gets one retry with the reason its test was refused
REPAIR_BUDGET = Budget(max_llm_calls=60, max_tokens=400_000, max_seconds=600)
WEAK_SANDBOX = ("Docker is not available: tests run as a plain subprocess with a timeout. "
                "This sandbox is weaker (no network or file system isolation).")
# A reproduction test that fails with one of these shows a broken test, not the bug.
NOT_THE_BUG = ("ImportError", "ModuleNotFoundError", "NameError", "SyntaxError", "fixture '")


def branch_name(run_id: str) -> str:
    return f"codexray/fix-{run_id}"


def repro_path(run_id: str) -> str:
    """The reproduction test file, at the repo root (the root is on sys.path in the sandbox)."""
    return f"test_codexray_repro_{run_id}.py"


def approved_branch_name(run_id: str) -> str:
    return f"codexray/approved-{run_id}"


class RepairWorkflow(Workflow):
    kind = "repair"
    start = "CREATED"
    final_states = frozenset({"AWAITING_APPROVAL", "FAILED"})
    review_retry_max_wait_s = 60.0  # tests set 0
    model_retry_max_wait_s = 60.0  # tests set 0

    def __init__(
        self,
        settings: Settings,
        index: IndexService,
        router: LLMRouter,
        sandbox: Sandbox,
        repo_root: Path,
        tools: ToolRegistry | None = None,
    ) -> None:
        self.settings = settings
        self.index = index
        self.router = router
        self.sandbox = sandbox
        self.repo_root = repo_root
        self.tools = tools or default_registry()
        self.worktrees_root = settings.data_path / "worktrees"

    def handlers(self):
        return {
            "CREATED": self.created,
            "BASELINE": self.baseline,
            "PLANNING": self.planning,
            "BRANCHED": self.branched,
            "REPRODUCING": self.reproducing,
            "DIAGNOSING": self.diagnosing,
            "PATCHING": self.patching,
            "TESTING": self.testing,
            "EVALUATING": self.evaluating,
            "REVIEWING": self.reviewing,
            "CLEANUP": self.cleanup,
        }

    def worktree(self, state: RunState) -> Path:
        return self.worktrees_root / state.run_id

    # ---------- states ----------

    async def created(self, state: RunState) -> str:
        return "BASELINE"

    async def baseline(self, state: RunState) -> str:
        run = await self._run_tests(state, self.repo_root, "baseline")
        if run.error and not run.no_tests:
            return self._fail(state, f"Baseline tests could not run: {run.error}.")
        state.artifacts["baseline"] = run.outcomes
        if not run.failed:
            state.artifacts["needs_repro"] = True
            why = "The repo has no tests" if run.no_tests else "No existing test fails"
            state.emit("agent_output", f"{why}; CodeXray will write a reproduction test after planning.",
                       agent="coordinator", needs_repro=True)
        return "PLANNING"

    async def planning(self, state: RunState) -> str:
        architect = RepairArchitect(self.router, self.tools, self._context(state))
        data = RepairArchitectInput(issue=state.inputs["issue"], failing_tests=self._baseline(state).failed)
        try:
            output = await architect.run(data, state)
        except AgentError as exc:
            return self._fail(state, f"The Architect could not pick files: {first_line(exc)}")
        files = self._usable_files(state, [f.file for f in output.files])
        if not files:
            return self._fail(state, "The Architect found no source files to change.")
        state.artifacts["files"] = files
        return "BRANCHED"

    async def branched(self, state: RunState) -> str:
        if git_ops.has_uncommitted_changes(self.repo_root):
            state.emit("agent_error", "Your checkout has uncommitted changes; the repair branch "
                       "starts from the last commit without them.", agent="coordinator", recoverable=True)
        state.artifacts["base_commit"] = git_ops.head_commit(self.repo_root)
        self._make_worktree(state)
        return "REPRODUCING" if state.artifacts.get("needs_repro") else "DIAGNOSING"

    async def reproducing(self, state: RunState) -> str:
        """Test writer suggests a reproduction test; plain code accepts it only if it fails right."""
        path = repro_path(state.run_id)
        test_file = self.worktree(state) / path
        feedback, problem = "", "no test was written"
        for attempt in range(1, MAX_REPRO_TRIES + 1):
            data = TestWriterInput(run_id=state.run_id, issue=state.inputs["issue"],
                                   files=state.artifacts["files"], test_file=path, feedback=feedback)
            ctx = self._context(state, worktree=True)
            ctx.test_file = path
            try:
                await TestWriter(self.router, self.tools, ctx).run(data, state)
            except AgentError as exc:
                problem = f"the Test writer gave no valid answer: {first_line(exc)}"
            if test_file.is_file():
                run = await self._run_tests(state, self.worktree(state), f"repro-{attempt}", only=path)
                problem = repro_problem(run)
                if problem is None:
                    return self._freeze_repro(state, run)
                feedback = f"{problem}\nTest output:\n{run.output[-2000:]}"
            else:
                feedback = f"{problem}. Call write_test with the complete file."
            state.emit("agent_output", f"Reproduction test not accepted (try {attempt} of "
                       f"{MAX_REPRO_TRIES}): {problem}", agent="coordinator", reason=problem)
        test_file.unlink(missing_ok=True)
        return self._fail(state, f"Could not write a test that reproduces the issue: {problem}.")

    async def diagnosing(self, state: RunState) -> str:
        data = DebuggerInput(
            run_id=state.run_id, issue=state.inputs["issue"],
            failing_tests=self._baseline(state).failed, files=state.artifacts["files"],
            failure_notes=[n["failure_note"] for n in state.artifacts["notes"]],
        )
        debugger = Debugger(self.router, self.tools, self._context(state, worktree=True))
        try:
            output = await debugger.run(data, state)
        except AgentError as exc:
            return self._attempt_failed(state, f"The Debugger gave no valid diagnosis: {first_line(exc)}")
        except DemoCacheMiss:
            raise
        except LLMError as exc:
            return await self._models_unavailable(state, "debugger", Debugger.lane, exc)
        state.artifacts["hypothesis"] = output.model_dump()
        return "PATCHING"

    async def patching(self, state: RunState) -> str:
        state.artifacts["patch"] = None
        state.artifacts["patch_rejections"] = []
        h = state.artifacts["hypothesis"]
        data = RepairInput(
            run_id=state.run_id, issue=state.inputs["issue"], root_cause=h["root_cause"],
            file=h["file"], start_line=h["start_line"], end_line=h["end_line"],
            fix_plan=h["fix_plan"], allowed_files=state.artifacts["files"],
        )
        ctx = self._context(state, worktree=True, allowed_files=state.artifacts["files"])
        agent_error = None
        try:
            await Repair(self.router, self.tools, ctx).run(data, state)
        except AgentError as exc:
            agent_error = first_line(exc)
        except DemoCacheMiss:
            raise
        except LLMError as exc:
            if not git_ops.worktree_diff(self.worktree(state)).strip():
                return await self._models_unavailable(state, "repair", Repair.lane, exc)
            agent_error = first_line(exc)  # a patch was written before the models gave out: test it

        rejections = state.artifacts["patch_rejections"]
        policy = [r["reason"] for r in rejections if r["policy"]]
        if policy:
            return self._attempt_failed(state, f"write_patch rejected the patch: {policy[0]}")
        diff = git_ops.worktree_diff(self.worktree(state))
        if not diff.strip():
            reason = rejections[-1]["reason"] if rejections else agent_error or "the Repair agent wrote no patch"
            return self._attempt_failed(state, f"No patch was applied: {reason}")
        state.artifacts["diff"] = diff
        return "TESTING"

    async def testing(self, state: RunState) -> str:
        run = await self._run_tests(state, self.worktree(state), f"attempt-{state.attempt}")
        state.artifacts["after"] = {"outcomes": run.outcomes, "error": run.error}
        return "EVALUATING"

    async def evaluating(self, state: RunState) -> str:
        state.emit("agent_started", "eval_gate started", agent="eval_gate", step=0)
        started = time.monotonic()
        after = TestRun(sandbox=self.sandbox.kind, outcomes=state.artifacts["after"]["outcomes"],
                        error=state.artifacts["after"]["error"])
        result: EvalResult = await asyncio.to_thread(
            eval_gate.evaluate, self._baseline(state), after, self.worktree(state), state.artifacts.get("repro"))
        state.artifacts["eval"] = result.model_dump()
        ok = eval_gate.passed(result)
        failed = [f"{c.name}: {c.detail}" for c in result.checks if not c.passed]
        state.emit("agent_output", f"eval {'passed' if ok else 'failed'}: "
                   f"{sum(c.passed for c in result.checks)}/{len(result.checks)} checks pass",
                   agent="eval_gate", ms=int((time.monotonic() - started) * 1000),
                   passed=ok, checks=state.artifacts["eval"]["checks"])
        if ok:
            return "REVIEWING"
        return self._attempt_failed(state, "The eval gate failed: " + "; ".join(failed), failed)

    async def reviewing(self, state: RunState) -> str:
        """Second opinion from a model that did not write the patch.

        The verdict is advisory (the human decides), but the review itself is required:
        if no reviewer model answers after one retry, the run fails instead of
        reaching approval without an independent review.
        """
        exclude = list(state.models_used.get("repair", []))
        h = state.artifacts["hypothesis"]
        data = ReviewerInput(
            run_id=state.run_id, issue=state.inputs["issue"], root_cause=h["root_cause"],
            diff=state.artifacts["diff"], test_summary=state.artifacts["test_results"][-1]["summary"],
            repro_test=(state.artifacts.get("repro") or {}).get("code", ""),
        )
        reviewer = Reviewer(self.router, self.tools, self._context(state, worktree=True))
        for attempt in (1, 2):
            try:
                output = await reviewer.run(data, state, exclude_models=exclude)
                break
            except BudgetExceeded as exc:
                return self._fail(state, f"Reviewer unavailable: {first_line(exc)}. "
                                  "An independent review is required.")
            except (AgentError, LLMError) as exc:
                if attempt == 2:
                    return self._fail(state, f"Reviewer unavailable after a retry: {first_line(exc)}. "
                                      "An independent review is required, so the patch was not offered "
                                      "for approval.")
                wait = self._review_wait(exclude)
                state.emit("agent_error", f"Reviewer unavailable ({first_line(exc)}); "
                           f"retrying in {wait:.0f} s.", agent="reviewer", recoverable=True)
                await asyncio.sleep(wait)
        review = {**output.model_dump(), "model": state.models_used["reviewer"][-1], "excluded_models": exclude}
        state.artifacts["review"] = review
        return "AWAITING_APPROVAL"

    def _review_wait(self, exclude: list[str]) -> float:
        return self._lane_wait("reviewer", self.review_retry_max_wait_s, exclude)

    def _lane_wait(self, lane: str, cap: float, exclude: list[str] | None = None) -> float:
        """Seconds until the lane's first model leaves its cooldown (5 s if none is cooling down), at most cap."""
        now = time.time()
        ends = [self.router.state.cooldown_until(e.provider, e.model)
                for e in self.router.lanes.get(lane, []) if not is_excluded(e.provider, e.model, exclude or [])]
        waits = [end - now + 1 for end in ends if end]
        return max(0.0, min(cap, min(waits) if waits else 5.0))

    async def _models_unavailable(self, state: RunState, agent: str, lane: str, exc: LLMError) -> str:
        """No model in the lane answered (rate limits, outage): that fails this attempt, not the run.
        Before the next attempt, wait for the lane's first model to cool down."""
        wait = self._lane_wait(lane, self.model_retry_max_wait_s) if state.attempt < MAX_ATTEMPTS else 0.0
        state.emit("agent_error", f"{agent} unavailable ({first_line(exc)}); attempt {state.attempt} fails"
                   + (f", the next one starts in {wait:.0f} s." if state.attempt < MAX_ATTEMPTS else "."),
                   agent=agent, recoverable=state.attempt < MAX_ATTEMPTS)
        await asyncio.sleep(wait)
        return self._attempt_failed(state, f"No model could answer for the {agent}: {first_line(exc)}")

    async def cleanup(self, state: RunState) -> str:
        """Failure note, delete the branch, then retry from DIAGNOSING or give up."""
        failure = state.artifacts.get("attempt_failure") or {"reason": "unknown", "failed_checks": []}
        note = await self._failure_note(state, failure)
        self._remove_worktree(state)
        h = state.artifacts.get("hypothesis") or {}
        state.artifacts["notes"].append({"attempt": state.attempt, "failure_note": note})
        state.artifacts.setdefault("attempts", []).append({
            "attempt": state.attempt, "root_cause": h.get("root_cause"), "fix_plan": h.get("fix_plan"),
            "diff": state.artifacts.get("diff"), "reason": failure["reason"], "failure_note": note,
        })
        state.emit("agent_output", f"Attempt {state.attempt} failed; branch deleted.", agent="coordinator",
                   failure_note=note, reason=failure["reason"], branch_deleted=branch_name(state.run_id))
        for key in ("diff", "hypothesis", "eval", "patch", "attempt_failure"):
            state.artifacts[key] = None
        if state.attempt >= MAX_ATTEMPTS:
            return self._fail(state, f"Gave up after {MAX_ATTEMPTS} failed attempts.")
        state.attempt += 1
        self._make_worktree(state)
        return "DIAGNOSING"

    # ---------- helpers ----------

    async def _run_tests(self, state: RunState, cwd: Path, label: str, only: str | None = None) -> TestRun:
        """The Test runner (plain code): run the tests in the sandbox and record the result.

        only: run just this test file. Otherwise the repo's test command, plus the
        frozen reproduction test when the run has one.
        """
        state.emit("agent_started", f"test_runner started ({label})", agent="test_runner", step=0)
        if self.sandbox.kind == "subprocess" and not state.artifacts.get("sandbox_warned"):
            state.emit("agent_error", WEAK_SANDBOX, agent="test_runner", recoverable=True)
            state.artifacts["sandbox_warned"] = True
        started = time.monotonic()
        results_dir = self.settings.data_path / "runs" / state.run_id
        repro = state.artifacts.get("repro")
        if only:
            run = await self.sandbox.run(cwd, f"pytest {only}", results_dir, label)
        else:
            run = await self.sandbox.run(cwd, state.inputs.get("test_command"), results_dir, label)
            if repro:
                extra = await self.sandbox.run(cwd, f"pytest {repro['path']}", results_dir, f"{label}-repro")
                run = merge_runs(run, extra)
        state.artifacts["test_results"].append({
            "attempt": label, "passed": len(run.passed), "failed": len(run.failed),
            "summary": run.summary(), "output": run.output,
        })
        state.emit("agent_output", f"{label} in {run.sandbox}: {run.summary()}", agent="test_runner",
                   ms=int((time.monotonic() - started) * 1000), sandbox=run.sandbox,
                   passed=len(run.passed), failed=len(run.failed), failing=run.failed, error=run.error)
        return run

    async def _failure_note(self, state: RunState, failure: dict) -> str:
        """The Summarizer's note, or a plain-code note if it cannot answer."""
        h = state.artifacts.get("hypothesis") or {}
        diff = state.artifacts.get("diff") or state.artifacts.get("patch") or ""
        results = state.artifacts["test_results"]
        test_output = results[-1]["output"] if results and results[-1]["attempt"] != "baseline" else ""
        data = SummarizerInput(
            issue=state.inputs["issue"], attempt=state.attempt,
            root_cause=h.get("root_cause", "(no diagnosis)"), fix_plan=h.get("fix_plan", ""),
            diff=diff, failed_checks=failure["failed_checks"] or [failure["reason"]],
            test_output=test_output,
        )
        try:
            return (await Summarizer(self.router).run(data, state)).failure_note
        except (AgentError, LLMError):
            return (f"Hypothesis: {data.root_cause}\nPatch idea: {data.fix_plan or '(none)'}\n"
                    f"Why it failed: {failure['reason']}")

    def _attempt_failed(self, state: RunState, reason: str, failed_checks: list[str] | None = None) -> str:
        state.artifacts["attempt_failure"] = {"reason": reason, "failed_checks": failed_checks or []}
        return "CLEANUP"

    def _fail(self, state: RunState, reason: str) -> str:
        state.artifacts["failure_reason"] = reason
        state.emit("agent_output", f"Run failed: {reason}", agent="coordinator", reason=reason,
                   attempts=state.artifacts.get("attempts", []))
        return "FAILED"

    def _freeze_repro(self, state: RunState, run: TestRun) -> str:
        """Commit the accepted reproduction test on the fix branch; later attempts start from it."""
        path = repro_path(state.run_id)
        raw = (self.worktree(state) / path).read_bytes()
        commit_id = git_ops.commit(self.worktree(state), [path],
                                   f"CodeXray reproduction test for {state.run_id}\n\n{state.inputs['issue'][:300]}")
        state.artifacts["base_commit"] = commit_id
        state.artifacts["repro"] = {"path": path, "code": raw.decode("utf-8", errors="replace"),
                                    "sha256": hashlib.sha256(raw).hexdigest(),
                                    "commit": commit_id, "targets": run.failed}
        # The new test's failures are the targets; anything in it that passes guards against regressions.
        state.artifacts["baseline"] = {**state.artifacts["baseline"], **run.outcomes}
        state.emit("agent_output", f"Reproduction test accepted: {len(run.failed)} test(s) fail on the "
                   f"unpatched code. Frozen in {path}; the fix may not change it.",
                   agent="coordinator", path=path, targets=run.failed, commit=commit_id)
        return "DIAGNOSING"

    def _baseline(self, state: RunState) -> TestRun:
        return TestRun(sandbox=self.sandbox.kind, outcomes=state.artifacts["baseline"])

    def _usable_files(self, state: RunState, files: list[str]) -> list[str]:
        """Indexed, non-test files, without duplicates, at most MAX_FILES."""
        skeleton = self.index.skeleton(state.repo_id)
        usable = []
        for path in files:
            path = path.replace("\\", "/").strip("/")
            if skeleton.file(path) and not is_test_path(path) and path not in usable:
                usable.append(path)
        return usable[:MAX_FILES]

    def _context(self, state: RunState, worktree: bool = False,
                 allowed_files: list[str] | None = None) -> ToolContext:
        return ToolContext(
            index=self.index, repo_id=state.repo_id, state=state,
            worktree=self.worktree(state) if worktree else None,
            worktrees_root=self.worktrees_root, allowed_files=allowed_files,
        )

    def _make_worktree(self, state: RunState) -> None:
        branch = branch_name(state.run_id)
        git_ops.add_worktree(self.repo_root, self.worktree(state), branch, state.artifacts["base_commit"])
        state.emit("agent_output", f"Created branch {branch} in a worktree", agent="coordinator",
                   branch=branch, base_commit=state.artifacts["base_commit"])

    def _remove_worktree(self, state: RunState) -> None:
        remove_repair_branch(self.repo_root, self.worktree(state), state.run_id)


def repro_problem(run: TestRun) -> str | None:
    """Why a reproduction test does not show the bug, or None if it does (plain code decides)."""
    if run.error:
        return f"the test could not run: {run.error}"
    if run.errored:
        return f"the test errored instead of failing an assertion: {run.messages.get(run.errored[0], '?')}"
    if not run.failed:
        return "the test passed on the unpatched code, so it does not show the bug"
    for test in run.failed:
        message = run.messages.get(test, "")
        if message.startswith(NOT_THE_BUG):
            return f"the test fails for a reason unrelated to the bug: {message}"
    return None


def first_line(exc: Exception) -> str:
    return (str(exc).splitlines() or [type(exc).__name__])[0]


def remove_repair_branch(repo_root: Path, worktree: Path, run_id: str) -> None:
    """Remove the run's worktree and delete its fix branch (safe to call twice)."""
    git_ops.remove_worktree(repo_root, worktree)
    git_ops.delete_branch(repo_root, branch_name(run_id))
