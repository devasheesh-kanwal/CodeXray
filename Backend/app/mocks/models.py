"""Models used only by mock fixtures (not part of the API contract)."""

from typing import Any

from pydantic import BaseModel, Field

from app.api.schemas.repair import EvalResult, EventKind, RepairState


class MockFiles(BaseModel):
    """Full content of each demo-repo file, as a list of lines."""

    files: dict[str, list[str]]


class RunUpdate(BaseModel):
    """Run fields a script step changes. A field set to null clears it."""

    root_cause: str | None = None
    diff: str | None = None
    eval: EvalResult | None = None
    reviewer_notes: str | None = None


class ScriptStep(BaseModel):
    """One step of the scripted repair run, due at_s seconds after start."""

    at_s: float = Field(ge=0)
    state: RepairState
    attempt: int = Field(ge=1)
    agent: str | None = None
    kind: EventKind
    message: str
    data: dict[str, Any] = Field(default_factory=dict)
    sets: RunUpdate = Field(default_factory=RunUpdate)


class RepairScript(BaseModel):
    max_attempts: int = Field(ge=1)
    steps: list[ScriptStep]
