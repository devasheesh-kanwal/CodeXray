"""Models for /api/llm/status."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ProviderStatus(BaseModel):
    """no_keys = none configured; disabled = every key was rejected (401/403)."""

    name: str
    state: Literal["available", "cooldown", "no_keys", "disabled"]
    cooldown_until: datetime | None = None


class LlmCall(BaseModel):
    lane: str
    provider: str
    model: str
    ok: bool
    switch_reason: str | None = None
    latency_ms: int = Field(ge=0)
    cached: bool


class LlmStatus(BaseModel):
    providers: list[ProviderStatus]
    recent_calls: list[LlmCall]
