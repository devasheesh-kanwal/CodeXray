"""Coordinator: runs a workflow as an explicit state machine (plain code, no LLM).

A Workflow names its states and gives one handler per state. Each handler does
its work (usually calling one agent) and returns the name of the next state.
Agents never call each other: handlers pass data through RunState.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from app.agents.events import EventBus
from app.agents.state import Budget, BudgetExceeded, RunState, WorkflowKind
from app.llm.errors import LLMError

logger = logging.getLogger("codexray.agents")

Handler = Callable[[RunState], Awaitable[str]]

__all__ = ["BudgetExceeded", "Coordinator", "EventBus", "Workflow"]


class Workflow:
    """Subclasses set kind, start and final_states, and return their handlers."""

    kind: WorkflowKind
    start: str
    final_states: frozenset[str]

    def handlers(self) -> dict[str, Handler]:
        raise NotImplementedError


class Coordinator:
    def __init__(self, runs_dir: Path, bus: EventBus | None = None) -> None:
        self.runs_dir = runs_dir
        self.bus = bus or EventBus()

    def new_run(
        self,
        workflow: Workflow,
        repo_id: str,
        inputs: dict[str, Any],
        budget: Budget | None = None,
    ) -> RunState:
        state = RunState.new(workflow.kind, repo_id, inputs, budget).attach(self.runs_dir, self.bus)
        state.save()
        return state

    def load(self, run_id: str) -> RunState | None:
        """A saved run (e.g. after a page refresh), attached to the live bus."""
        state = RunState.load(self.runs_dir, run_id)
        return state.attach(self.runs_dir, self.bus) if state else None

    async def run(self, workflow: Workflow, state: RunState) -> RunState:
        """Run until a final state, a budget runs out, or a step fails."""
        try:
            await asyncio.wait_for(self._loop(workflow, state), timeout=state.budget.max_seconds)
            state.status = "done"
        except (BudgetExceeded, TimeoutError) as exc:
            state.status = "stopped"
            state.stop_reason = (
                str(exc) if isinstance(exc, BudgetExceeded)
                else f"time budget used up ({state.budget.max_seconds:.0f} s)"
            )
        except LLMError as exc:
            # Expected when providers are down or a DEMO_MODE question is not cached: the
            # API turns it into 503 LLM_UNAVAILABLE, so log one line, not a traceback.
            logger.warning("Run %s stopped in state %s: %s", state.run_id, state.machine_state,
                           str(exc).splitlines()[0] if str(exc) else type(exc).__name__)
            state.status = "failed"
            state.stop_reason = f"{type(exc).__name__}: {str(exc).splitlines()[0] if str(exc) else ''}"
        except Exception as exc:
            logger.exception("Run %s failed in state %s", state.run_id, state.machine_state)
            state.status = "failed"
            state.stop_reason = f"{type(exc).__name__}: {str(exc).splitlines()[0] if str(exc) else ''}"
        state.emit("run_finished", _finish_summary(state), status=state.status,
                   reason=state.stop_reason, usage=state.usage.model_dump())
        self.bus.close(state.run_id)
        return state

    async def _loop(self, workflow: Workflow, state: RunState) -> None:
        handlers = workflow.handlers()
        current = state.machine_state or workflow.start
        while current not in workflow.final_states:
            if current not in handlers:
                raise RuntimeError(f"workflow {workflow.kind} has no handler for state {current}")
            state.machine_state = current
            state.emit("state_change", f"-> {current}", state=current, attempt=state.attempt)
            current = await handlers[current](state)
        state.machine_state = current
        state.emit("state_change", f"-> {current}", state=current, attempt=state.attempt)


def _finish_summary(state: RunState) -> str:
    if state.status == "done":
        return f"run finished in state {state.machine_state}"
    return f"run {state.status}: {state.stop_reason}"
