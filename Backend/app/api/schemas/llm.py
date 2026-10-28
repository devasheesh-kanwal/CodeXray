"""Models for /api/llm/status, /api/llm/models and /api/llm/selection."""

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


class ModelInfo(BaseModel):
    """One model from routes.yaml (or EXTRA_PROVIDERS) and its state right now.

    unavailable = not in the provider's model list, or refused with 403 this session.
    """

    id: str = Field(description='"provider/model", the value to send to PUT /api/llm/selection')
    provider: str
    model: str
    max_context: int
    lanes: list[str]
    state: Literal["available", "cooldown", "no_keys", "disabled", "unavailable"]
    cooldown_until: datetime | None = None


class ModelsResponse(BaseModel):
    """auto: each lane uses its models in order, sticking with the last one that answered.
    manual: `selected` is tried first everywhere; if it fails, the next working model answers."""

    mode: Literal["auto", "manual"]
    selected: str | None = None
    models: list[ModelInfo]


class SelectionRequest(BaseModel):
    model: str | None = Field(description='A model id from GET /api/llm/models, or null for automatic')
