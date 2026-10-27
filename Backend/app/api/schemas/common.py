"""Types shared by several endpoints."""

from typing import Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    mock_mode: bool
    demo_mode: bool


class AgentTraceStep(BaseModel):
    """One step an agent took, shown in the frontend's agent timeline."""

    agent: str
    step: int = Field(ge=1)
    action: str
    summary: str
    ms: int = Field(ge=0)


class Citation(BaseModel):
    file: str
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    why: str
