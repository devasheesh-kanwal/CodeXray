"""A fake set of OpenAI-compatible providers for router tests (no network)."""

import json
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field

import httpx2

from app.llm.providers import BASE_URLS
from app.llm.router import LLMRouter
from app.llm.routes import LaneEntry
from tests.conftest import FakeClock, make_settings

HOST_TO_PROVIDER = {httpx2.URL(url).host: name for name, url in BASE_URLS.items()}

Reply = Callable[[httpx2.Request], httpx2.Response]


@dataclass
class Call:
    provider: str
    model: str
    key_tail: str
    body: dict


@dataclass
class FakeProviders:
    """Scripted replies per model. Each request takes the next reply; the last repeats."""

    scripts: dict[str, list[Reply]] = field(default_factory=dict)
    model_lists: dict[str, list[str]] = field(default_factory=dict)
    calls: list[Call] = field(default_factory=list)

    def on(self, model: str, *replies: Reply) -> None:
        self.scripts[model] = list(replies)

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        provider = HOST_TO_PROVIDER[request.url.host]
        if request.url.path.endswith("/models"):
            ids = self.model_lists.get(provider)
            if ids is None:
                return httpx2.Response(500, json={"error": {"message": "boom"}})
            return httpx2.Response(
                200,
                json={"object": "list", "data": [
                    {"id": i, "object": "model", "created": 0, "owned_by": provider}
                    for i in ids
                ]},
            )
        body = json.loads(request.content)
        key_tail = request.headers["authorization"][-4:]
        self.calls.append(Call(provider, body["model"], key_tail, body))
        replies = self.scripts.get(body["model"]) or [ok("default answer")]
        reply = replies.pop(0) if len(replies) > 1 else replies[0]
        return reply(request)

    def transport(self) -> httpx2.MockTransport:
        return httpx2.MockTransport(self.handle)

    def models_called(self) -> list[str]:
        return [c.model for c in self.calls]


# ---------- reply builders ----------


def completion_json(text: str, tool_calls: list[dict] | None = None) -> dict:
    message: dict = {"role": "assistant", "content": text}
    if tool_calls:
        message["tool_calls"] = tool_calls
    return {
        "id": "c1", "object": "chat.completion", "created": 0, "model": "m",
        "choices": [{"index": 0, "message": message, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 3, "total_tokens": 13},
    }


def ok(text: str, tool_calls: list[dict] | None = None) -> Reply:
    return lambda req: httpx2.Response(200, json=completion_json(text, tool_calls))


def error(status: int, message: str = "error", code: str | None = None,
          headers: dict | None = None) -> Reply:
    body = {"error": {"message": message, "code": code}}
    return lambda req: httpx2.Response(status, json=body, headers=headers or {})


def timeout() -> Reply:
    def reply(req: httpx2.Request) -> httpx2.Response:
        raise httpx2.ReadTimeout("timed out", request=req)
    return reply


def sse_chunk(text: str) -> bytes:
    chunk = {
        "id": "s1", "object": "chat.completion.chunk", "created": 0, "model": "m",
        "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}],
    }
    return f"data: {json.dumps(chunk)}\n\n".encode()


def stream(*texts: str, break_after: int | None = None) -> Reply:
    """SSE stream of `texts`. With break_after=n, the connection drops after n chunks."""

    async def body() -> AsyncIterator[bytes]:
        for i, text in enumerate(texts):
            if break_after is not None and i == break_after:
                raise httpx2.ReadError("connection reset")
            yield sse_chunk(text)
        yield b"data: [DONE]\n\n"

    return lambda req: httpx2.Response(
        200, headers={"content-type": "text/event-stream"}, content=body()
    )


# ---------- router factory ----------

LANE = "test"
ENTRIES = [
    LaneEntry(provider="groq", model="small-a", max_context=8_000),
    LaneEntry(provider="nvidia", model="mid-b", max_context=8_000),
    LaneEntry(provider="openrouter", model="big-c:free", max_context=100_000),
]


@dataclass
class RouterKit:
    router: LLMRouter
    fake: FakeProviders
    clock: FakeClock
    sleeps: list[float]


def make_router(tmp_path, entries=ENTRIES, **settings) -> RouterKit:
    fake = FakeProviders()
    clock = FakeClock()
    clock.now = 1_800_000_000.0
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        clock.advance(seconds)

    values = {
        "groq_api_keys": "gsk_first1111,gsk_second2222",
        "nvidia_api_keys": "nvapi_only3333",
        "openrouter_api_keys": "sk-or-only4444",
    }
    values.update(settings)
    router = LLMRouter(
        make_settings(tmp_path, **values),
        lanes={LANE: list(entries)},
        transport=fake.transport(),
        sleep=fake_sleep,
        clock=clock,
    )
    return RouterKit(router, fake, clock, sleeps)


def user(text: str) -> list[dict]:
    return [{"role": "user", "content": text}]
