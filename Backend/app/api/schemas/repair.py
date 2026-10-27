"""Models for the repair loop: /repair and /api/repairs/..."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

RepairState = Literal[
    "CREATED",
    "BASELINE",
    "PLANNING",
    "BRANCHED",
    "DIAGNOSING",
    "PATCHING",
    "TESTING",
    "EVALUATING",
    "REVIEWING",
    "AWAITING_APPROVAL",
    "MERGED",
    "REJECTED",
    "FAILED",
    "CLEANUP",
]

# States after which nothing more happens on a run.
FINAL_STATES = {"MERGED", "REJECTED", "FAILED"}

EventKind = Literal["state", "agent", "tests", "eval", "note", "error"]


class RepairRequest(BaseModel):
    issue: str = Field(min_length=1, max_length=4000)
    test_command: str | None = None


class RepairStarted(BaseModel):
    run_id: str


class RepairEvent(BaseModel):
    """One thing that happened in a run; also the SSE 'repair_event' payload."""

    ts: datetime
    state: RepairState
    attempt: int = Field(ge=1)
    agent: str | None = None
    kind: EventKind
    message: str
    data: dict[str, Any] = Field(default_factory=dict)


class EvalCheck(BaseModel):
    name: str
    passed: bool
    detail: str


class EvalResult(BaseModel):
    checks: list[EvalCheck]


class RepairRun(BaseModel):
    state: RepairState
    attempt: int = Field(ge=1)
    max_attempts: int = Field(ge=1)
    diff: str | None = None
    eval: EvalResult | None = None
    reviewer_notes: str | None = None
    root_cause: str | None = None
    events: list[RepairEvent]
