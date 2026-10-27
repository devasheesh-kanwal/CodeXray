"""The LLM router: the only code that talks to LLM providers.

Each call names a lane (see routes.yaml). The router tries the lane's entries
in order and switches to the next one on rate limits, errors, and context
overflows. See README "How the LLM router switches" for the rules.
"""

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Any, TypeVar

import httpx2
import openai
from openai import AsyncOpenAI
from pydantic import BaseModel, ValidationError

from app.api.schemas.llm import LlmStatus
from app.config import Settings
from app.llm import jsonout
from app.llm.cache import LLMCache, cache_key
from app.llm.errors import (
    AllProvidersFailed,
    Attempt,
    DemoCacheMiss,
    InvalidLLMOutput,
    LLMError,
    LLMStreamError,
)
from app.llm.providers import BASE_URLS, key_pools
from app.llm.routes import LaneEntry, load_routes
from app.llm.state import CallRecord, RouterState
from app.llm.types import LLMResponse, ToolCall

logger = logging.getLogger("codexray.llm")

Message = dict[str, Any]
T = TypeVar("T", bound=BaseModel)

DEFAULT_COOLDOWN_S = 60.0
RETRY_DELAY_S = 2.0
REPLY_RESERVE_TOKENS = 1024  # room left for the answer when checking max_context
MODELS_CHECK_TIMEOUT_S = 10.0
CONTEXT_ERROR_HINTS = (
    "context_length_exceeded",
    "context length",
    "maximum context",
    "context window",
    "too many tokens",
    "prompt is too long",
)


class EntryFailed(Exception):
    """One lane entry failed; the router moves on to the next entry."""

    def __init__(self, outcome: str, detail: str) -> None:
        super().__init__(detail)
        self.outcome = outcome
        self.detail = detail


@dataclass
class Success:
    """Result of the call function, plus what the router needs to log it."""

    entry: LaneEntry
    result: Any
    started: float
    switch_reason: str | None


def estimate_tokens(messages: list[Message]) -> int:
    """Rough token count: ~4 characters per token, plus a little per message."""
    chars = sum(
        len(m["content"]) if isinstance(m.get("content"), str) else len(json.dumps(m))
        for m in messages
    )
    return chars // 4 + 4 * len(messages)


def base_name(model: str) -> str:
    """'openai/gpt-oss-120b:free' -> 'openai/gpt-oss-120b' (variant suffix ignored)."""
    return model.split(":")[0].lower()


def is_excluded(provider: str, model: str, exclude: list[str] | None) -> bool:
    """True if `model` or `provider/model` is in exclude (ignoring ':free' etc.)."""
    names = {base_name(model), base_name(f"{provider}/{model}")}
    return any(base_name(x) in names for x in exclude or [])


def retry_after_seconds(error: openai.APIStatusError) -> float:
    try:
        return max(float(error.response.headers.get("retry-after", "")), 1.0)
    except ValueError:
        return DEFAULT_COOLDOWN_S


def is_context_error(error: openai.APIStatusError) -> bool:
    text = f"{error.code or ''} {error.message}".lower()
    return any(hint in text for hint in CONTEXT_ERROR_HINTS)


# Gemini's documented placeholder for tool calls it did not make itself.
SKIP_SIGNATURE = {"google": {"thought_signature": "skip_thought_signature_validator"}}


def messages_for(provider: str, messages: list[Message]) -> list[Message]:
    """Fit tool-call history to the provider (it changes after a mid-loop fallback).

    Gemini 3 needs a thought_signature on every earlier tool call and answers
    400 without one: calls made by other providers get a placeholder. Other
    providers may reject Gemini's `extra_content` field, so it is removed.
    """
    if not any(m.get("tool_calls") for m in messages):
        return messages
    fitted = []
    for message in messages:
        if message.get("tool_calls"):
            if provider == "gemini":
                calls = [tc if tc.get("extra_content") else {**tc, "extra_content": SKIP_SIGNATURE}
                         for tc in message["tool_calls"]]
            else:
                calls = [{k: v for k, v in tc.items() if k != "extra_content"}
                         for tc in message["tool_calls"]]
            message = {**message, "tool_calls": calls}
        fitted.append(message)
    return fitted


def short(error: Exception) -> str:
    return str(error).replace("\n", " ")[:200]


class LLMRouter:
    """`transport`, `sleep` and `clock` are injectable so tests never touch the network."""

    def __init__(
        self,
        settings: Settings,
        lanes: dict[str, list[LaneEntry]] | None = None,
        transport: httpx2.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.lanes = lanes if lanes is not None else load_routes()
        self.keys = key_pools(settings)
        self.cache = LLMCache(settings.data_path / "cache.sqlite")
        self.demo_mode = settings.demo_mode
        self.timeout = settings.llm_timeout_s
        self.transport = transport
        self.sleep = sleep
        self.clock = clock
        self.state = RouterState(clock)
        self._clients: dict[tuple[str, int], AsyncOpenAI] = {}

    # ---------- public API ----------

    async def ask(
        self,
        lane: str,
        messages: list[Message],
        temperature: float = 0.2,
        tools: list[dict[str, Any]] | None = None,
        exclude_models: list[str] | None = None,
        max_tokens: int | None = None,
        accept: Callable[[LLMResponse], bool] | None = None,
    ) -> LLMResponse:
        """One chat completion, with fallback and caching.

        With `accept`, only answers it accepts are cached, and a cached answer
        it rejects is ignored (asked again), so a bad answer is never replayed.
        In DEMO_MODE a cached answer is always returned (there is no API to ask).
        """
        key = cache_key(lane, messages, temperature, None, tools, max_tokens)
        cached = self._from_cache(lane, key, exclude_models)
        if cached and (accept is None or self.demo_mode or accept(cached)):
            return cached
        response = await self._complete(
            lane, messages, temperature, tools, exclude_models, max_tokens
        )
        if accept is None or accept(response):
            self._store(key, response)
        return response

    async def stream(
        self,
        lane: str,
        messages: list[Message],
        temperature: float = 0.2,
        exclude_models: list[str] | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str | LLMResponse]:
        """Yield text chunks, then one LLMResponse summary.

        Switches model only before the first chunk; a failure after that
        raises LLMStreamError.
        """
        key = cache_key(lane, messages, temperature, max_tokens=max_tokens)
        cached = self._from_cache(lane, key, exclude_models)
        if cached:
            yield cached.text
            yield cached
            return

        async def open_stream(entry: LaneEntry, client: AsyncOpenAI):
            extra = {"max_tokens": max_tokens} if max_tokens else {}
            chunks = await client.chat.completions.create(
                model=entry.model,
                messages=messages,
                temperature=temperature,
                stream=True,
                **extra,
            )
            chunks = chunks.__aiter__()
            first = await self._next_text(chunks)  # errors here can still switch
            return chunks, first

        done = await self._run_lane(lane, messages, exclude_models, open_stream)
        chunks, first = done.result
        parts: list[str] = []
        try:
            text = first
            while text is not None:
                parts.append(text)
                yield text
                text = await self._next_text(chunks)
        except Exception as exc:
            self._record_failure(lane, done.entry, done.started, done.switch_reason, short(exc))
            raise LLMStreamError(
                f"{done.entry.label} failed mid-stream: {short(exc)}"
            ) from exc

        response = self._response(done, "".join(parts), [])
        self._record_success(lane, done, response.latency_ms, None)
        self._store(key, response)
        yield response

    async def ask_json(
        self,
        lane: str,
        messages: list[Message],
        schema: type[T],
        temperature: float = 0.1,
        exclude_models: list[str] | None = None,
        max_tokens: int | None = None,
    ) -> tuple[T, LLMResponse]:
        """Ask for JSON matching `schema`; retry once with the validation error."""
        messages = jsonout.with_json_instruction(messages, schema)
        key = cache_key(lane, messages, temperature, schema.__name__, max_tokens=max_tokens)
        cached = self._from_cache(lane, key, exclude_models)
        if cached:
            return jsonout.parse_json(cached.text, schema), cached

        response = await self._complete(
            lane, messages, temperature, None, exclude_models, max_tokens
        )
        try:
            parsed = jsonout.parse_json(response.text, schema)
        except ValidationError as first_error:
            logger.warning("Invalid JSON from %s/%s; retrying once", response.provider, response.model)
            retry = jsonout.retry_messages(messages, response.text, str(first_error))
            response = await self._complete(
                lane, retry, temperature, None, exclude_models, max_tokens
            )
            try:
                parsed = jsonout.parse_json(response.text, schema)
            except ValidationError as second_error:
                raise InvalidLLMOutput(str(second_error), response.text) from second_error
        self._store(key, response)  # only validated answers are cached
        return parsed, response

    def status(self) -> LlmStatus:
        return self.state.status(self.keys)

    async def check_models(self) -> list[str]:
        """Ask each enabled provider for its model list; skip configured models it lacks.

        Returns the warnings (also logged). Never raises.
        """
        warnings: list[str] = []
        used = {e.provider for entries in self.lanes.values() for e in entries}
        await asyncio.gather(*(self._check_provider(p, warnings) for p in sorted(used)))
        return warnings

    async def probe(self, entry: LaneEntry) -> tuple[bool, int, str]:
        """Send one tiny request to exactly this entry (no fallback, no cache).

        Returns (ok, latency_ms, reply or error). Used by scripts/check_providers.py.
        """
        messages = [{"role": "user", "content": "Reply with the single word OK."}]
        started = self.clock()
        try:
            completion = await self._try_entry(entry, self._chat_call(messages, 0, None))
        except EntryFailed as failed:
            return False, self._ms_since(started), f"{failed.outcome}: {failed.detail}"
        text = completion.choices[0].message.content or ""
        return True, self._ms_since(started), text.strip()[:40]

    # ---------- the fallback loop ----------

    async def _complete(
        self,
        lane: str,
        messages: list[Message],
        temperature: float,
        tools: list[dict[str, Any]] | None,
        exclude: list[str] | None,
        max_tokens: int | None = None,
    ) -> LLMResponse:
        call = self._chat_call(messages, temperature, tools, max_tokens)
        done = await self._run_lane(lane, messages, exclude, call)
        completion = done.result
        message = completion.choices[0].message
        tool_calls = [
            ToolCall(
                id=tc.id,
                name=tc.function.name,
                arguments=tc.function.arguments,
                extra_content=(tc.model_extra or {}).get("extra_content"),
            )
            for tc in message.tool_calls or []
        ]
        response = self._response(done, message.content or "", tool_calls, completion.usage)
        self._record_success(lane, done, response.latency_ms, completion.usage)
        return response

    def _chat_call(self, messages, temperature, tools, max_tokens=None):
        async def call(entry: LaneEntry, client: AsyncOpenAI):
            kwargs: dict[str, Any] = {
                "model": entry.model,
                "messages": messages_for(entry.provider, messages),
                "temperature": temperature,
            }
            if tools:
                kwargs["tools"] = tools
            if max_tokens:
                kwargs["max_tokens"] = max_tokens
            completion = await client.chat.completions.create(**kwargs)
            if not completion.choices:
                raise EntryFailed("empty_response", "provider returned no choices")
            return completion

        return call

    async def _run_lane(self, lane, messages, exclude, call) -> Success:
        """Try each usable entry of the lane in order until one succeeds."""
        if lane not in self.lanes:
            raise LLMError(f"Unknown lane '{lane}'. Lanes: {sorted(self.lanes)}")
        needed = estimate_tokens(messages) + REPLY_RESERVE_TOKENS
        overflowed_at = 0  # largest max_context that already hit a context error
        attempts: list[Attempt] = []
        switch_reason: str | None = None

        for entry in self.lanes[lane]:
            skip = self._skip_reason(entry, needed, exclude, overflowed_at)
            if skip:
                attempts.append(Attempt(entry.label, "skipped", skip))
                continue
            started = self.clock()
            try:
                result = await self._try_entry(entry, call)
                return Success(entry, result, started, switch_reason)
            except EntryFailed as failed:
                attempts.append(Attempt(entry.label, failed.outcome, failed.detail))
                self._record_failure(lane, entry, started, switch_reason, failed.detail)
                logger.warning("[%s] %s failed: %s", lane, entry.label, failed.detail)
                switch_reason = f"{entry.label}: {failed.detail}"
                if failed.outcome == "context_length":
                    overflowed_at = max(overflowed_at, entry.max_context)

        raise AllProvidersFailed(lane, attempts)

    def _skip_reason(self, entry, needed, exclude, overflowed_at) -> str | None:
        if is_excluded(entry.provider, entry.model, exclude):
            return "in exclude_models"
        until = self.state.cooldown_until(entry.provider, entry.model)
        if until:
            return f"cooling down for {until - self.clock():.0f}s more"
        if (entry.provider, entry.model) in self.state.missing_models:
            return "not in the provider's model list"
        if (entry.provider, entry.model) in self.state.forbidden_models:
            return "refused with 403 earlier this session"
        pool = self.keys[entry.provider]
        if not pool.configured:
            return "no API keys configured"
        if not pool.active():
            return "every API key was rejected (401)"
        if entry.max_context <= overflowed_at:
            return f"context {entry.max_context} not larger than one that overflowed"
        if needed > entry.max_context:
            return f"needs ~{needed} tokens, max_context is {entry.max_context}"
        return None

    async def _try_entry(self, entry: LaneEntry, call):
        """Call one entry: rotate keys on 401, retry once on 5xx/timeout."""
        pool = self.keys[entry.provider]
        for index, key in pool.active():
            client = self._client(entry.provider, index, key)
            for attempt in (1, 2):
                try:
                    return await call(entry, client)
                except openai.RateLimitError as exc:
                    seconds = retry_after_seconds(exc)
                    self.state.cool_down(entry.provider, entry.model, seconds)
                    raise EntryFailed(
                        "rate_limited", f"rate limited (429), cooling down {seconds:.0f}s"
                    ) from exc
                except openai.AuthenticationError:
                    # 401: the key itself is bad.
                    pool.disable(index)
                    logger.warning(
                        "%s key %s rejected (401); disabled for this session",
                        entry.provider, pool.masked(index),
                    )
                    break  # try the provider's next key
                except openai.PermissionDeniedError as exc:
                    # 403: the key works, but this model is not allowed for it
                    # (e.g. a gated free model). Skip the model, keep the keys.
                    self.state.forbidden_models.add((entry.provider, entry.model))
                    raise EntryFailed("forbidden", f"403: {short(exc)}") from exc
                except openai.BadRequestError as exc:
                    if is_context_error(exc):
                        raise EntryFailed("context_length", "prompt too long (400)") from exc
                    raise EntryFailed("bad_request", f"400: {short(exc)}") from exc
                except (
                    openai.InternalServerError,
                    openai.APIConnectionError,
                    httpx2.TransportError,  # raw network errors while reading a stream
                ) as exc:
                    kind = "timeout" if isinstance(exc, openai.APITimeoutError) else "server_error"
                    if attempt == 1:
                        await self.sleep(RETRY_DELAY_S)
                        continue
                    raise EntryFailed(kind, f"{kind} twice: {short(exc)}") from exc
                except openai.APIStatusError as exc:
                    raise EntryFailed(f"http_{exc.status_code}", short(exc)) from exc
                except openai.APIError as exc:
                    raise EntryFailed("api_error", short(exc)) from exc
        raise EntryFailed("auth", "every API key was rejected (401)")

    # ---------- helpers ----------

    def _client(self, provider: str, index: int, key: str) -> AsyncOpenAI:
        if (provider, index) not in self._clients:
            http_client = (
                httpx2.AsyncClient(transport=self.transport) if self.transport else None
            )
            self._clients[(provider, index)] = AsyncOpenAI(
                api_key=key,
                base_url=BASE_URLS[provider],
                timeout=self.timeout,
                max_retries=0,  # the router does its own retries
                http_client=http_client,
            )
        return self._clients[(provider, index)]

    @staticmethod
    async def _next_text(chunks) -> str | None:
        """Next non-empty text piece of a stream, or None at the end."""
        async for chunk in chunks:
            if chunk.choices and chunk.choices[0].delta.content:
                return chunk.choices[0].delta.content
        return None

    def _from_cache(self, lane, key, exclude) -> LLMResponse | None:
        started = self.clock()
        hit = self.cache.get(key)
        if hit and not is_excluded(hit["provider"], hit["model"], exclude):
            response = LLMResponse(**hit, cached=True, latency_ms=self._ms_since(started))
            self.state.record(
                CallRecord(lane, response.provider, response.model, ok=True,
                           latency_ms=response.latency_ms, cached=True)
            )
            return response
        if self.demo_mode:
            raise DemoCacheMiss(lane)
        return None

    def _store(self, key: str, response: LLMResponse) -> None:
        self.cache.put(
            key, response.model_dump(include={"text", "tool_calls", "provider", "model"})
        )

    def _response(
        self, done: Success, text: str, tool_calls: list[ToolCall], usage=None
    ) -> LLMResponse:
        return LLMResponse(
            text=text,
            tool_calls=tool_calls,
            provider=done.entry.provider,
            model=done.entry.model,
            cached=False,
            latency_ms=self._ms_since(done.started),
            prompt_tokens=getattr(usage, "prompt_tokens", None) or 0,
            completion_tokens=getattr(usage, "completion_tokens", None) or 0,
        )

    def _record_success(self, lane, done: Success, latency_ms: int, usage) -> None:
        self.state.record(
            CallRecord(
                lane, done.entry.provider, done.entry.model, ok=True,
                latency_ms=latency_ms, switch_reason=done.switch_reason,
                prompt_tokens=getattr(usage, "prompt_tokens", None),
                completion_tokens=getattr(usage, "completion_tokens", None),
            )
        )
        logger.info(
            "[%s] %s ok in %d ms (tokens in/out: %s/%s)%s",
            lane, done.entry.label, latency_ms,
            getattr(usage, "prompt_tokens", "?"), getattr(usage, "completion_tokens", "?"),
            f" after switch: {done.switch_reason}" if done.switch_reason else "",
        )

    def _record_failure(self, lane, entry, started, switch_reason, error) -> None:
        self.state.record(
            CallRecord(
                lane, entry.provider, entry.model, ok=False,
                latency_ms=self._ms_since(started),
                switch_reason=switch_reason, error=error,
            )
        )

    async def _check_provider(self, provider: str, warnings: list[str]) -> None:
        active = self.keys[provider].active()
        if not active:
            return
        client = self._client(provider, *active[0])

        async def list_ids() -> set[str]:
            return {m.id.removeprefix("models/") async for m in client.models.list()}

        try:
            ids = await asyncio.wait_for(list_ids(), MODELS_CHECK_TIMEOUT_S)
        except Exception as exc:
            message = f"Could not list {provider} models ({short(exc)}); not checking them"
            logger.warning(message)
            warnings.append(message)
            return
        configured = {e.model for es in self.lanes.values() for e in es if e.provider == provider}
        for model in sorted(configured - ids):
            self.state.missing_models.add((provider, model))
            message = f"{provider}/{model} is not in {provider}'s model list; skipping it"
            logger.warning(message)
            warnings.append(message)

    def _ms_since(self, started: float) -> int:
        return max(int((self.clock() - started) * 1000), 0)
