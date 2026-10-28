"""LLMRouter.stream: chunks, summary, switching only before the first chunk."""

import asyncio

import pytest

from app.llm import DemoCacheMiss, LLMResponse, LLMStreamError
from tests.llm.fakes import LANE, error, make_router, stream, user


async def collect(agen) -> tuple[list[str], LLMResponse | None]:
    chunks, summary = [], None
    async for item in agen:
        if isinstance(item, LLMResponse):
            summary = item
        else:
            chunks.append(item)
    return chunks, summary


def test_stream_yields_chunks_then_summary(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", stream("Hel", "lo ", "world"))
    chunks, summary = asyncio.run(collect(kit.router.stream(LANE, user("hi"))))
    assert chunks == ["Hel", "lo ", "world"]
    assert summary.text == "Hello world" and summary.model == "small-a"
    assert kit.fake.calls[0].body["stream"] is True


def test_stream_switches_on_failure_before_first_chunk(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", error(429))
    kit.fake.on("mid-b", stream("from ", "b"))
    chunks, summary = asyncio.run(collect(kit.router.stream(LANE, user("hi"))))
    assert "".join(chunks) == "from b"
    assert summary.model == "mid-b"


def test_stream_switches_if_connection_drops_before_first_chunk(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", stream("never", break_after=0))
    kit.fake.on("mid-b", stream("ok"))
    chunks, summary = asyncio.run(collect(kit.router.stream(LANE, user("hi"))))
    assert chunks == ["ok"] and summary.model == "mid-b"


def test_stream_does_not_switch_after_first_chunk(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", stream("partial ", "answer", break_after=1))
    received: list[str] = []

    async def consume():
        async for item in kit.router.stream(LANE, user("hi")):
            received.append(item)

    with pytest.raises(LLMStreamError, match="mid-stream"):
        asyncio.run(consume())
    assert received == ["partial "]
    assert set(kit.fake.models_called()) == {"small-a"}  # no other provider tried
    assert kit.router.state.calls[-1].ok is False


def test_stream_result_is_cached_and_replayed(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", stream("a", "b"))
    asyncio.run(collect(kit.router.stream(LANE, user("hi"))))
    chunks, summary = asyncio.run(collect(kit.router.stream(LANE, user("hi"))))
    assert chunks == ["ab"] and summary.cached
    assert len(kit.fake.calls) == 1


def test_stream_asks_again_when_replay_rejects_the_cached_text(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", stream("NOT_FOUND"), stream("the ", "answer"))
    live_only = lambda r: r.text != "NOT_FOUND"  # noqa: E731
    asyncio.run(collect(kit.router.stream(LANE, user("hi"), replay=live_only)))
    chunks, summary = asyncio.run(collect(kit.router.stream(LANE, user("hi"), replay=live_only)))
    assert chunks == ["the ", "answer"] and not summary.cached
    assert len(kit.fake.calls) == 2


def test_stream_in_demo_mode_never_calls(tmp_path):
    kit = make_router(tmp_path, demo_mode=True)
    with pytest.raises(DemoCacheMiss):
        asyncio.run(collect(kit.router.stream(LANE, user("hi"))))
    assert kit.fake.calls == []
