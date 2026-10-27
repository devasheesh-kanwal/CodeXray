"""Errors raised by the LLM router."""

from dataclasses import dataclass


class LLMError(Exception):
    """Base class for every router error."""


@dataclass
class Attempt:
    """What happened to one lane entry during a call."""

    entry: str  # "provider/model"
    outcome: str  # e.g. "skipped", "rate_limited", "server_error", "ok"
    detail: str


class AllProvidersFailed(LLMError):
    """Every entry in the lane was skipped or failed."""

    def __init__(self, lane: str, attempts: list[Attempt]) -> None:
        self.lane = lane
        self.attempts = attempts
        lines = [f"  - {a.entry}: {a.outcome} ({a.detail})" for a in attempts]
        super().__init__(f"All models in lane '{lane}' failed:\n" + "\n".join(lines))


class InvalidLLMOutput(LLMError):
    """ask_json got invalid JSON twice (first answer and one retry)."""

    def __init__(self, errors: str, raw: str) -> None:
        self.errors = errors
        self.raw = raw
        super().__init__(f"LLM output did not match the schema after a retry: {errors}")


class DemoCacheMiss(LLMError):
    """DEMO_MODE is on and this request is not in the cache."""

    def __init__(self, lane: str) -> None:
        super().__init__(
            f"DEMO_MODE is on and this '{lane}' request is not cached. "
            "Run it once with DEMO_MODE=false to cache it."
        )


class LLMStreamError(LLMError):
    """A stream failed after its first chunk, so it could not switch models."""
