"""SQLite cache and DEMO_MODE."""

import asyncio

import pytest

from app.llm import DemoCacheMiss
from tests.llm.fakes import LANE, make_router, ok, user


def test_cache_hit_makes_no_call(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", ok("first"))
    first = asyncio.run(kit.router.ask(LANE, user("same question")))
    second = asyncio.run(kit.router.ask(LANE, user("same question")))

    assert len(kit.fake.calls) == 1
    assert second.cached is True and first.cached is False
    assert (second.text, second.provider, second.model) == ("first", "groq", "small-a")
    assert kit.router.state.calls[-1].cached is True


def test_rejected_answers_are_not_cached(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", ok("bad"), ok("good"))
    is_good = lambda r: r.text == "good"  # noqa: E731

    assert asyncio.run(kit.router.ask(LANE, user("q"), accept=is_good)).text == "bad"
    second = asyncio.run(kit.router.ask(LANE, user("q"), accept=is_good))
    assert second.text == "good" and not second.cached  # "bad" was not replayed
    third = asyncio.run(kit.router.ask(LANE, user("q"), accept=is_good))
    assert third.text == "good" and third.cached
    assert len(kit.fake.calls) == 2


def test_a_cached_answer_that_is_now_rejected_is_asked_again(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", ok("bad"), ok("good"))
    asyncio.run(kit.router.ask(LANE, user("q")))  # cached without a check
    response = asyncio.run(kit.router.ask(LANE, user("q"), accept=lambda r: r.text == "good"))
    assert response.text == "good" and len(kit.fake.calls) == 2


def test_a_cached_answer_replay_rejects_is_stored_but_asked_again(tmp_path):
    # A "nothing found" verdict is kept (for DEMO_MODE) but never replayed live.
    kit = make_router(tmp_path)
    kit.fake.on("small-a", ok("nothing found"), ok("found it"))
    live_only = lambda r: r.text != "nothing found"  # noqa: E731

    first = asyncio.run(kit.router.ask(LANE, user("q"), replay=live_only))
    second = asyncio.run(kit.router.ask(LANE, user("q"), replay=live_only))
    third = asyncio.run(kit.router.ask(LANE, user("q"), replay=live_only))

    assert (first.text, second.text, third.text) == ("nothing found", "found it", "found it")
    assert (second.cached, third.cached) == (False, True)  # the new answer replaced the old one
    assert len(kit.fake.calls) == 2


def test_a_skipped_cache_hit_is_not_recorded_as_a_cached_call(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", ok("nothing found"), ok("found it"))
    asyncio.run(kit.router.ask(LANE, user("q")))
    asyncio.run(kit.router.ask(LANE, user("q"), replay=lambda r: r.text != "nothing found"))
    assert [call.cached for call in kit.router.state.calls] == [False, False]


def test_demo_mode_replays_what_replay_rejects(tmp_path):
    live = make_router(tmp_path)
    live.fake.on("small-a", ok("nothing found"))
    asyncio.run(live.router.ask(LANE, user("q")))

    demo = make_router(tmp_path, demo_mode=True)
    response = asyncio.run(demo.router.ask(LANE, user("q"), replay=lambda r: False))
    assert response.text == "nothing found" and response.cached
    assert demo.fake.calls == []


def test_cache_survives_a_new_router(tmp_path):
    kit = make_router(tmp_path)
    asyncio.run(kit.router.ask(LANE, user("q")))
    again = make_router(tmp_path)  # same data dir -> same cache.sqlite
    response = asyncio.run(again.router.ask(LANE, user("q")))
    assert response.cached and again.fake.calls == []
    assert (tmp_path / "cache.sqlite").exists()


@pytest.mark.parametrize(
    "change",
    [
        {"messages": user("other question")},
        {"temperature": 0.9},
        {"tools": [{"type": "function", "function": {"name": "f", "parameters": {}}}]},
    ],
)
def test_different_request_is_a_miss(tmp_path, change):
    kit = make_router(tmp_path)
    asyncio.run(kit.router.ask(LANE, user("q")))
    args = {"messages": user("q"), "temperature": 0.2, **change}
    response = asyncio.run(kit.router.ask(LANE, **args))
    assert response.cached is False
    assert len(kit.fake.calls) == 2


def test_cached_answer_from_excluded_model_is_not_served(tmp_path):
    kit = make_router(tmp_path)
    asyncio.run(kit.router.ask(LANE, user("review this patch")))  # answered by small-a
    response = asyncio.run(
        kit.router.ask(LANE, user("review this patch"), exclude_models=["small-a"])
    )
    assert response.cached is False
    assert response.model == "mid-b"


def test_demo_mode_serves_cache_and_never_calls(tmp_path):
    live = make_router(tmp_path)
    live.fake.on("small-a", ok("cached for the demo"))
    asyncio.run(live.router.ask(LANE, user("demo question")))

    demo = make_router(tmp_path, demo_mode=True)
    response = asyncio.run(demo.router.ask(LANE, user("demo question")))
    assert response.text == "cached for the demo" and response.cached

    with pytest.raises(DemoCacheMiss, match="DEMO_MODE"):
        asyncio.run(demo.router.ask(LANE, user("not cached")))
    assert demo.fake.calls == []


def test_demo_mode_miss_when_cached_model_is_excluded(tmp_path):
    live = make_router(tmp_path)
    asyncio.run(live.router.ask(LANE, user("q")))
    demo = make_router(tmp_path, demo_mode=True)
    with pytest.raises(DemoCacheMiss):
        asyncio.run(demo.router.ask(LANE, user("q"), exclude_models=["small-a"]))
    assert demo.fake.calls == []


def test_max_tokens_is_sent_and_part_of_the_cache_key(tmp_path):
    kit = make_router(tmp_path)
    asyncio.run(kit.router.ask(LANE, user("q")))
    response = asyncio.run(kit.router.ask(LANE, user("q"), max_tokens=50))
    assert response.cached is False
    assert kit.fake.calls[1].body["max_tokens"] == 50
    assert "max_tokens" not in kit.fake.calls[0].body


def test_token_counts_are_reported_and_zero_for_cache_hits(tmp_path):
    kit = make_router(tmp_path)
    first = asyncio.run(kit.router.ask(LANE, user("q")))
    assert (first.prompt_tokens, first.completion_tokens) == (10, 3)
    cached = asyncio.run(kit.router.ask(LANE, user("q")))
    assert (cached.prompt_tokens, cached.completion_tokens) == (0, 0)
