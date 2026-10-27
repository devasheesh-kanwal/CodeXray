"""Public result types of the LLM router."""

from typing import Any

from pydantic import BaseModel, Field


class ToolCall(BaseModel):
    id: str
    name: str
    arguments: str  # JSON string, exactly as the model produced it
    # Provider data that must be sent back with this call on the next turn
    # (Gemini 3 puts its required thought_signature here).
    extra_content: dict[str, Any] | None = None


class LLMResponse(BaseModel):
    text: str
    tool_calls: list[ToolCall] = Field(default_factory=list)
    provider: str
    model: str
    cached: bool
    latency_ms: int
    prompt_tokens: int = 0  # 0 for cache hits or when the provider doesn't report usage
    completion_tokens: int = 0
