"""RepairService: starts repair runs, reports them in the API's shape, and
handles the human's approve / reject.

One repair run per repo at a time (a second one gets 409). The lock is held
until the run is MERGED, REJECTED or FAILED, so a run awaiting approval still
blocks a new one for the same repo.
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from pathlib import Path

from app.agents.coordinator import Coordinator
from app.agents.state import RunEvent, RunState
from app.agents.tools import ToolRegistry
from app.api.schemas.repair import EvalResult, RepairEvent, RepairRun
from app.api.sse import sse_event
from app.config import Settings
from app.errors import ApiError, not_found
from app.indexing.intake import load_meta
from app.indexing.service import IndexService
from app.llm import LLMRouter
from app.repair import git_ops
from app.repair.sandbox import BadTestCommand, Sandbox, pytest_args
from app.repair.workflow import (
    MAX_ATTEMPTS,
    REPAIR_BUDGET,
    RepairWorkflow,
    approved_branch_name,
    branch_name,
    remove_repair_branch,
)

logger = logging.getLogger("codexray.repair")

STATE_MESSAGES = {
    "CREATED": "Repair run created.",
    "BASELINE": "Running the tests on the current checkout to confirm the failure.",
    "PLANNING": "Architect is picking the files to change.",
    "BRANCHED": "Creating a git worktree branch for the fix.",
    "DIAGNOSING": "Debugger is looking for the root cause.",
    "PATCHING": "Repair agent is writing a patch.",
    "TESTING": "Running the tests on the patched branch.",
    "EVALUATING": "Eval gate is checking the result.",
    "REVIEWING": "Reviewer (a different model) is reviewing the patch.",
    "AWAITING_APPROVAL": "Waiting for human approval.",
    "CLEANUP": "Attempt failed: writing a failure note and deleting the branch.",
    "FAILED": "Repair failed.",
    "MERGED": "Approved; merged into a local branch (not pushed).",
    "REJECTED": "Rejected; the repair branch was deleted.",
}
# Which plain-code or LLM agent's output is which RepairEvent kind (default: "agent").
OUTPUT_KINDS = {"test_runner": "tests", "eval_gate": "eval", "summarizer": "note", "coordinator": "note"}


class RepairService:
    def __init__(
        self,
        settings: Settings,
        index: IndexService,
        router: LLMRouter,
        sandbox: Sandbox | None = None,
        tools: ToolRegistry | None = None,
    ) -> None:
        self.settings = settings
        self.index = index
        self.router = router
        self.sandbox = sandbox or Sandbox(settings.repair_test_timeout_s, settings.sandbox_image)
        self.tools = tools
        self.coordinator = Coordinator(settings.data_path / "runs")
        self.active: dict[str, str] = {}  # repo_id -> run_id
        self.live: dict[str, RunState] = {}  # run_id -> state, while the server runs
        self.tasks: dict[str, asyncio.Task] = {}

    # ---------- start ----------

    def start(self, repo_id: str, issue: str, test_command: str | None) -> RunState:
        """Validate, take the repo's lock and run the workflow in the background."""
        root = self._check_repo(repo_id)
        try:
            pytest_args(test_command)
        except (BadTestCommand, ValueError) as exc:
            raise ApiError(422, "VALIDATION_ERROR", str(exc), {"field": "test_command"}) from exc
        if repo_id in self.active:
            raise ApiError(409, "INVALID_STATE", "A repair run is already active for this repo",
                           {"repo_id": repo_id, "run_id": self.active[repo_id]})
        workflow = RepairWorkflow(self.settings, self.index, self.router, self.sandbox, root, self.tools)
        state = self.coordinator.new_run(
            workflow, repo_id, {"issue": issue, "test_command": test_command, "repo_root": str(root)},
            REPAIR_BUDGET.model_copy(),
        )
        self.active[repo_id] = state.run_id
        self.live[state.run_id] = state
        self.tasks[state.run_id] = asyncio.create_task(self._run(workflow, state))
        return state

    async def _run(self, workflow: RepairWorkflow, state: RunState) -> RunState:
        try:
            await self.coordinator.run(workflow, state)
        finally:
            if api_state(state) != "AWAITING_APPROVAL":  # FAILED, stopped or crashed
                await asyncio.to_thread(self._cleanup, state)
                self._release(state)
        return state

    async def wait(self, run_id: str) -> RunState:
        """Wait until the run's background work stops (tests use this)."""
        task = self.tasks.get(run_id)
        if task is not None:
            await task
        return self._state(run_id)

    def _check_repo(self, repo_id: str) -> Path:
        stage = self.index.status(repo_id).stage  # 404 for an unknown repo
        if stage != "ready":
            raise ApiError(409, "INVALID_STATE", f"Repo is not ready for repairs (stage: {stage})",
                           {"repo_id": repo_id, "stage": stage})
        root = Path(load_meta(self.settings.data_path, repo_id).root).resolve()
        if git_ops.toplevel(root) != root:
            raise ApiError(409, "INVALID_STATE", "Repairs need the repo to be the root of a local git "
                           "repository", {"repo_id": repo_id})
        return root

    # ---------- approve / reject ----------

    async def decide(self, run_id: str, approve: bool) -> RepairRun:
        state = self._state(run_id)
        current = api_state(state)
        if current != "AWAITING_APPROVAL":
            raise ApiError(409, "INVALID_STATE", f"Run is {current}; it can only be approved or "
                           "rejected in AWAITING_APPROVAL", {"run_id": run_id, "state": current})
        if approve:
            branch = await asyncio.to_thread(self._merge, state)
            state.machine_state = "MERGED"
            state.emit("state_change", f"-> MERGED ({branch})", state="MERGED",
                       attempt=state.attempt, branch=branch)
        else:
            await asyncio.to_thread(self._cleanup, state)
            state.machine_state = "REJECTED"
            state.emit("state_change", "-> REJECTED", state="REJECTED", attempt=state.attempt,
                       branch_deleted=branch_name(run_id))
        self._release(state)
        return self.snapshot(run_id)

    def _merge(self, state: RunState) -> str:
        """Commit the patch in the worktree and point codexray/approved-<run_id> at it.

        The fix branch starts at the base commit, so this is a fast-forward merge
        into a new local branch. The user's checked-out branch is never touched.
        """
        root = Path(state.inputs["repo_root"])
        worktree = self.settings.data_path / "worktrees" / state.run_id
        paths = git_ops.changed_files(worktree)
        message = f"CodeXray repair {state.run_id}\n\n{state.inputs['issue'][:500]}"
        commit_id = git_ops.commit(worktree, paths, message)
        approved = approved_branch_name(state.run_id)
        git_ops.create_branch(root, approved, commit_id)
        remove_repair_branch(root, worktree, state.run_id)
        state.artifacts["approved_branch"] = approved
        state.artifacts["approved_commit"] = commit_id
        return approved

    def _cleanup(self, state: RunState) -> None:
        try:
            worktree = self.settings.data_path / "worktrees" / state.run_id
            remove_repair_branch(Path(state.inputs["repo_root"]), worktree, state.run_id)
        except Exception:
            logger.exception("Could not clean up the worktree of run %s", state.run_id)

    def _release(self, state: RunState) -> None:
        if self.active.get(state.repo_id) == state.run_id:
            del self.active[state.repo_id]

    # ---------- reads ----------

    def snapshot(self, run_id: str) -> RepairRun:
        state = self._state(run_id)
        a = state.artifacts
        return RepairRun(
            state=api_state(state),
            attempt=state.attempt,
            max_attempts=MAX_ATTEMPTS,
            diff=a.get("diff"),
            eval=EvalResult.model_validate(a["eval"]) if a.get("eval") else None,
            reviewer_notes=reviewer_notes(a.get("review")),
            root_cause=(a.get("hypothesis") or {}).get("root_cause"),
            events=to_repair_events(state),
        )

    async def events(self, run_id: str) -> AsyncIterator[str]:
        """SSE: past events, then live ones; ends with done at AWAITING_APPROVAL or a final state."""
        state = self._state(run_id)
        converter = EventConverter(state)
        async for event in self.coordinator.bus.subscribe(run_id, list(state.events)):
            repair_event = converter.convert(event)
            if repair_event is not None:
                yield sse_event("repair_event", repair_event)
        yield sse_event("done", {"state": api_state(state)})

    def _state(self, run_id: str) -> RunState:
        state = self.live.get(run_id) or self.coordinator.load(run_id)
        if state is None or state.workflow != "repair":
            raise not_found("Repair run", run_id=run_id)
        return state


# ---------- RunState -> API shapes ----------


def api_state(state: RunState) -> str:
    """The run's repair state; a stopped or crashed run is FAILED."""
    if state.status in ("stopped", "failed"):
        return "FAILED"
    return state.machine_state or "CREATED"


def reviewer_notes(review: dict | None) -> str | None:
    if not review:
        return None
    if review.get("verdict") is None:
        return review["notes"]
    lines = [f"Risk: {review['risk']}. Verdict: {review['verdict']} (model: {review['model']}).",
             review["notes"]]
    lines += [f"- {concern}" for concern in review.get("concerns", [])]
    return "\n".join(lines)


class EventConverter:
    """Turns RunEvents into RepairEvents, tracking the state and attempt they happened in."""

    def __init__(self, state: RunState) -> None:
        self.run = state
        self.state = "CREATED"
        self.attempt = 1

    def convert(self, event: RunEvent) -> RepairEvent | None:
        data = dict(event.data)
        kind, message, agent = "agent", event.summary, event.agent or "coordinator"
        if event.kind == "state_change":
            self.state, self.attempt = data.pop("state"), data.pop("attempt", self.attempt)
            kind, agent = "state", "coordinator"
            message = STATE_MESSAGES.get(self.state, message)
            if self.state == "CREATED":
                data["issue"] = self.run.inputs.get("issue")
            if self.state == "AWAITING_APPROVAL":
                data["branch"] = branch_name(self.run.run_id)
        elif event.kind == "run_finished":
            if data.get("status") == "done":
                return None  # the final state_change already says it
            self.state, kind = "FAILED", "error"
        elif event.kind == "agent_output":
            kind = OUTPUT_KINDS.get(agent, "agent")
        elif event.kind == "agent_error":
            kind = "note" if data.get("recoverable") else "error"
        return RepairEvent(ts=event.ts, state=self.state, attempt=self.attempt, agent=agent,
                           kind=kind, message=message, data=data)


def to_repair_events(state: RunState) -> list[RepairEvent]:
    converter = EventConverter(state)
    return [e for e in map(converter.convert, state.events) if e is not None]

