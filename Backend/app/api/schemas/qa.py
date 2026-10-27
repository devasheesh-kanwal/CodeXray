"""Models for architecture Q&A: /ask and /ask/stream."""

from typing import Literal

from pydantic import BaseModel, Field

from app.api.schemas.common import AgentTraceStep, Citation


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


class AskResponse(BaseModel):
    answer: str
    citations: list[Citation]
    confidence: float = Field(ge=0, le=1)
    not_found: bool
    provider: str
    model: str
    cached: bool
    agent_trace: list[AgentTraceStep] | None = None


# --- SSE event payloads for /ask/stream ---


class AgentEvent(BaseModel):
    """event: agent"""

    agent: str
    status: Literal["running", "done", "failed"]
    detail: str | None = None  # e.g. "searching code"; optional, for the UI


class TokenEvent(BaseModel):
    """event: token"""

    text: str


class FinalEvent(BaseModel):
    """event: final"""

    citations: list[Citation]
    confidence: float = Field(ge=0, le=1)
    not_found: bool
    provider: str
    model: str
    agent_trace: list[AgentTraceStep]
