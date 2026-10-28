"""Router state for this server session: cooldowns, missing models, recent calls."""

import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from app.api.schemas.llm import LlmCall, LlmStatus, ProviderStatus
from app.llm.providers import KeyPool

MAX_RECENT_CALLS = 50


@dataclass
class CallRecord:
    """One attempt to get an answer from one model (or from the cache)."""

    lane: str
    provider: str
    model: str
    ok: bool
    latency_ms: int
    cached: bool = False
    switch_reason: str | None = None
    error: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class RouterState:
    """`clock` returns Unix seconds; tests inject a fake one."""

    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self.clock = clock
        self.cooldowns: dict[tuple[str, str], float] = {}
        self.missing_models: set[tuple[str, str]] = set()  # not in /models at startup
        self.forbidden_models: set[tuple[str, str]] = set()  # answered 403 this session
        self.calls: deque[CallRecord] = deque(maxlen=MAX_RECENT_CALLS)

    def cool_down(self, provider: str, model: str, seconds: float) -> None:
        self.cooldowns[(provider, model)] = self.clock() + seconds

    def cooldown_until(self, provider: str, model: str) -> float | None:
        """End of the cooldown as Unix time, or None if not cooling down."""
        until = self.cooldowns.get((provider, model))
        return until if until and until > self.clock() else None

    def record(self, call: CallRecord) -> None:
        self.calls.append(call)

    def status(self, keys: dict[str, KeyPool]) -> LlmStatus:
        """Data for GET /api/llm/status. Calls are oldest first."""
        return LlmStatus(
            providers=[self._provider_status(name, pool) for name, pool in keys.items()],
            recent_calls=[
                LlmCall(
                    lane=c.lane,
                    provider=c.provider,
                    model=c.model,
                    ok=c.ok,
                    switch_reason=c.switch_reason,
                    latency_ms=c.latency_ms,
                    cached=c.cached,
                )
                for c in self.calls
            ],
        )

    def _provider_status(self, name: str, pool: KeyPool) -> ProviderStatus:
        if not pool.configured:
            return ProviderStatus(name=name, state="no_keys")
        if not pool.active():
            return ProviderStatus(name=name, state="disabled")
        # "cooldown" = at least one of this provider's models is cooling down.
        ends = [
            until
            for (provider, model) in self.cooldowns
            if provider == name and (until := self.cooldown_until(provider, model))
        ]
        if ends:
            return ProviderStatus(
                name=name,
                state="cooldown",
                cooldown_until=datetime.fromtimestamp(max(ends), UTC),
            )
        return ProviderStatus(name=name, state="available")
