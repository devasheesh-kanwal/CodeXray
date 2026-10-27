"""RunState: everything about one workflow run, saved to data/runs/<run_id>.json
after every step so a page refresh can rebuild the timeline."""

import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, PrivateAttr

WorkflowKind = Literal["qa", "review", "repair"]
EventKind = Literal[
    "agent_started",
    "tool_call",
    "tool_result",
    "agent_output",
    "agent_error",
    "citation_dropped",  # from the Citation checker
    "state_change",  # from the Coordinator
    "run_finished",  # from the Coordinator
]
RunStatus = Literal["running", "done", "stopped", "failed"]
RUN_ID = re.compile(r"^run_[0-9a-f]{12}$")


class BudgetExceeded(Exception):
    """A run used up one of its budgets; the Coordinator stops it."""


class RunEvent(BaseModel):
    seq: int
    ts: datetime
    run_id: str
    kind: EventKind
    agent: str | None = None
    step: int | None = None
    summary: str  # one short human-readable line, never full file content
    ms: int | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class Budget(BaseModel):
    max_llm_calls: int = 25
    max_tokens: int = 200_000
    max_seconds: float = 300.0


class Usage(BaseModel):
    llm_calls: int = 0
    tokens: int = 0
    seconds: float = 0.0


def default_artifacts() -> dict[str, Any]:
    return {
        "selected_code": None,
        "hypothesis": None,
        "patch": None,
        "test_results": [],
        "eval": None,
        "notes": [],
        "findings": [],
    }


class RunState(BaseModel):
    run_id: str
    workflow: WorkflowKind
    repo_id: str
    inputs: dict[str, Any] = Field(default_factory=dict)
    artifacts: dict[str, Any] = Field(default_factory=default_artifacts)
    models_used: dict[str, list[str]] = Field(default_factory=dict)  # agent -> ["provider/model"]
    attempt: int = 1
    budget: Budget = Field(default_factory=Budget)
    usage: Usage = Field(default_factory=Usage)
    events: list[RunEvent] = Field(default_factory=list)
    status: RunStatus = "running"
    stop_reason: str | None = None
    machine_state: str | None = None  # current Coordinator state
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    _runs_dir: Path | None = PrivateAttr(default=None)
    _bus: Any = PrivateAttr(default=None)  # EventBus (duck-typed to avoid an import cycle)

    @classmethod
    def new(
        cls,
        workflow: WorkflowKind,
        repo_id: str,
        inputs: dict[str, Any] | None = None,
        budget: Budget | None = None,
    ) -> "RunState":
        return cls(
            run_id=f"run_{uuid.uuid4().hex[:12]}",
            workflow=workflow,
            repo_id=repo_id,
            inputs=inputs or {},
            budget=budget or Budget(),
        )

    def attach(self, runs_dir: Path | None, bus: Any = None) -> "RunState":
        """Where to save, and which event bus to publish on."""
        self._runs_dir = runs_dir
        self._bus = bus
        return self

    # ---------- persistence ----------

    def save(self) -> None:
        self.usage.seconds = round(self.elapsed_seconds(), 3)
        if self._runs_dir is None:
            return
        self._runs_dir.mkdir(parents=True, exist_ok=True)
        tmp = self._runs_dir / f"{self.run_id}.json.tmp"
        tmp.write_text(self.model_dump_json(indent=1), encoding="utf-8")
        tmp.replace(self._runs_dir / f"{self.run_id}.json")

    @classmethod
    def load(cls, runs_dir: Path, run_id: str) -> "RunState | None":
        if not RUN_ID.match(run_id):
            return None
        path = runs_dir / f"{run_id}.json"
        if not path.is_file():
            return None
        return cls.model_validate_json(path.read_text(encoding="utf-8")).attach(runs_dir)

    # ---------- events ----------

    def emit(
        self,
        kind: EventKind,
        summary: str,
        agent: str | None = None,
        step: int | None = None,
        ms: int | None = None,
        **data: Any,
    ) -> RunEvent:
        """Record an event, save the run, and publish it to live subscribers."""
        event = RunEvent(
            seq=len(self.events) + 1, ts=datetime.now(UTC), run_id=self.run_id, kind=kind,
            agent=agent, step=step, summary=summary[:300], ms=ms, data=data,
        )
        self.events.append(event)
        self.save()
        if self._bus is not None:
            self._bus.publish(self.run_id, event)
        return event

    # ---------- models and budgets ----------

    def record_model(self, agent: str, provider: str, model: str) -> None:
        used = self.models_used.setdefault(agent, [])
        if f"{provider}/{model}" not in used:
            used.append(f"{provider}/{model}")

    def charge(self, prompt_tokens: int, completion_tokens: int) -> None:
        self.usage.llm_calls += 1
        self.usage.tokens += prompt_tokens + completion_tokens

    def elapsed_seconds(self) -> float:
        return (datetime.now(UTC) - self.created_at).total_seconds()

    def check_budget(self) -> None:
        """Raise BudgetExceeded if another LLM call would go over a budget."""
        if self.usage.llm_calls >= self.budget.max_llm_calls:
            raise BudgetExceeded(f"LLM call budget used up ({self.budget.max_llm_calls} calls)")
        if self.usage.tokens >= self.budget.max_tokens:
            raise BudgetExceeded(f"token budget used up ({self.budget.max_tokens} tokens)")
        if self.elapsed_seconds() >= self.budget.max_seconds:
            raise BudgetExceeded(f"time budget used up ({self.budget.max_seconds:.0f} s)")
