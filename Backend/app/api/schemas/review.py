"""Models for PR review: /review."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.api.schemas.common import AgentTraceStep


class ReviewRequest(BaseModel):
    """Either diff_text, or both base_branch and head_branch."""

    diff_text: str | None = None
    base_branch: str | None = None
    head_branch: str | None = None

    @model_validator(mode="after")
    def diff_or_branches(self) -> ReviewRequest:
        has_diff = bool(self.diff_text)
        has_branches = bool(self.base_branch) and bool(self.head_branch)
        has_any_branch = bool(self.base_branch) or bool(self.head_branch)
        if has_diff and has_any_branch:
            raise ValueError("give diff_text or base_branch+head_branch, not both")
        if not has_diff and not has_branches:
            raise ValueError("give diff_text, or both base_branch and head_branch")
        return self


class Finding(BaseModel):
    id: str
    category: Literal["bug", "security", "practice", "design"]
    severity: Literal["critical", "high", "medium", "low"]
    file: str
    line: int = Field(ge=1)
    title: str
    explanation: str
    suggested_fix: str
    source: Literal["llm", "ruff", "bandit", "rule"]
    confidence: float = Field(ge=0, le=1)


class ReviewResponse(BaseModel):
    summary: str
    findings: list[Finding]
    agent_trace: list[AgentTraceStep] | None = None
