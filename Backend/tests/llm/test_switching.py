"""Switching rules of LLMRouter.ask."""

import asyncio

import pytest

from app.llm import AllProvidersFailed, LLMError
from app.llm.routes import LaneEntry
from tests.llm.fakes import ENTRIES, LANE, error, make_router, ok, timeout, user


def test_first_entry_answers(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", ok("hello"))
    response = asyncio.run(kit.router.ask(LANE, user("hi")))
    assert (response.text, response.provider, response.model) == ("hello", "groq", "small-a")
    assert response.cached is False
    assert kit.fake.models_called() == ["small-a"]


def test_429_switches_to_next_model_and_uses_retry_after(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", error(429, "slow down", headers={"retry-after": "7"}))
    kit.fake.on("mid-b", ok("from b"))

    response = asyncio.run(kit.router.ask(LANE, user("hi")))

    assert response.model == "mid-b"
    assert kit.fake.models_called() == ["small-a", "mid-b"]
    assert kit.router.state.cooldown_until("groq", "small-a") == kit.clock.now + 7
    last = kit.router.state.calls[-1]
    assert last.ok and "groq/small-a: rate limited (429)" in last.switch_reason


def test_429_without_retry_after_cools_down_60s(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", error(429))
    asyncio.run(kit.router.ask(LANE, user("hi")))
    assert kit.router.state.cooldown_until("groq", "small-a") == kit.clock.now + 60


def test_cooldown_is_respected_until_it_expires(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", error(429, headers={"retry-after": "30"}), ok("a is back"))
    asyncio.run(kit.router.ask(LANE, user("one")))
    assert kit.fake.models_called() == ["small-a", "mid-b"]

    asyncio.run(kit.router.ask(LANE, user("two")))
    assert kit.fake.models_called() == ["small-a", "mid-b", "mid-b"]  # a skipped

    kit.clock.advance(31)
    response = asyncio.run(kit.router.ask(LANE, user("three")))
    assert response.text == "a is back"


def test_401_disables_key_and_tries_providers_next_key(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", error(401, "bad key"), ok("second key works"))

    response = asyncio.run(kit.router.ask(LANE, user("hi")))

    assert response.text == "second key works"
    assert [c.key_tail for c in kit.fake.calls] == ["1111", "2222"]
    assert kit.router.keys["groq"].disabled == {0}

    asyncio.run(kit.router.ask(LANE, user("again")))
    assert kit.fake.calls[-1].key_tail == "2222"  # disabled key never used again


def test_401_on_every_key_moves_to_next_entry_and_status_says_disabled(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", error(401, "invalid api key"))
    response = asyncio.run(kit.router.ask(LANE, user("hi")))
    assert response.model == "mid-b"
    assert [c.key_tail for c in kit.fake.calls[:2]] == ["1111", "2222"]
    groq = next(p for p in kit.router.status().providers if p.name == "groq")
    assert groq.state == "disabled"


def test_403_skips_only_that_model_and_keeps_keys(tmp_path):
    entries = [
        LaneEntry(provider="openrouter", model="gated:free", max_context=8_000),
        LaneEntry(provider="openrouter", model="open:free", max_context=8_000),
    ]
    kit = make_router(tmp_path, entries=entries)
    kit.fake.on("gated:free", error(403, "only available on agentic harnesses"))
    kit.fake.on("open:free", ok("same key, other model"))

    response = asyncio.run(kit.router.ask(LANE, user("hi")))

    assert response.text == "same key, other model"
    assert kit.router.keys["openrouter"].disabled == set()
    openrouter = next(p for p in kit.router.status().providers if p.name == "openrouter")
    assert openrouter.state == "available"

    asyncio.run(kit.router.ask(LANE, user("again")))
    assert kit.fake.models_called() == ["gated:free", "open:free", "open:free"]


def test_403_is_reported_as_forbidden(tmp_path):
    kit = make_router(tmp_path, entries=[ENTRIES[0]])
    kit.fake.on("small-a", error(403, "not allowed"))
    with pytest.raises(AllProvidersFailed) as exc:
        asyncio.run(kit.router.ask(LANE, user("hi")))
    assert exc.value.attempts[0].outcome == "forbidden"
    assert len(kit.fake.calls) == 1  # no second key tried for a 403


def test_401_warning_masks_the_key(tmp_path, caplog):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", error(401), ok("x"))
    asyncio.run(kit.router.ask(LANE, user("hi")))
    assert "****1111" in caplog.text
    assert "gsk_first1111" not in caplog.text


def test_context_length_error_skips_to_a_larger_context(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", error(400, "This model's maximum context length is 8000 tokens"))
    kit.fake.on("big-c:free", ok("big answer"))

    response = asyncio.run(kit.router.ask(LANE, user("long question")))

    assert response.model == "big-c:free"
    assert kit.fake.models_called() == ["small-a", "big-c:free"]  # mid-b (8000) skipped


def test_other_400_moves_on_without_context_skip(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", error(400, "unsupported parameter"))
    response = asyncio.run(kit.router.ask(LANE, user("hi")))
    assert response.model == "mid-b"


def test_prompt_estimate_skips_small_entries_without_calling_them(tmp_path):
    kit = make_router(tmp_path)
    huge = "x" * 40_000  # ~10k tokens > 8k
    response = asyncio.run(kit.router.ask(LANE, user(huge)))
    assert kit.fake.models_called() == ["big-c:free"]
    assert response.model == "big-c:free"


def test_5xx_is_retried_once_after_2s_then_succeeds(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", error(503, "overloaded"), ok("recovered"))
    response = asyncio.run(kit.router.ask(LANE, user("hi")))
    assert response.text == "recovered"
    assert kit.sleeps == [2.0]
    assert kit.fake.models_called() == ["small-a", "small-a"]


def test_5xx_twice_moves_to_next_entry(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", error(500))
    response = asyncio.run(kit.router.ask(LANE, user("hi")))
    assert response.model == "mid-b"
    assert kit.fake.models_called() == ["small-a", "small-a", "mid-b"]


def test_timeout_is_retried_once_then_next_entry(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", timeout())
    response = asyncio.run(kit.router.ask(LANE, user("hi")))
    assert response.model == "mid-b"
    assert kit.sleeps == [2.0]


def test_all_failing_raises_with_every_attempt(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", error(429))
    kit.fake.on("mid-b", error(500))
    kit.fake.on("big-c:free", error(404, "no such model"))

    with pytest.raises(AllProvidersFailed) as exc:
        asyncio.run(kit.router.ask(LANE, user("hi")))

    outcomes = [(a.entry, a.outcome) for a in exc.value.attempts]
    assert outcomes == [
        ("groq/small-a", "rate_limited"),
        ("nvidia/mid-b", "server_error"),
        ("openrouter/big-c:free", "http_404"),
    ]
    assert "groq/small-a" in str(exc.value)


def test_exclude_models_forces_fallback(tmp_path):
    kit = make_router(tmp_path)
    response = asyncio.run(
        kit.router.ask(LANE, user("review"), exclude_models=["small-a", "nvidia/mid-b"])
    )
    assert response.model == "big-c:free"
    assert kit.fake.models_called() == ["big-c:free"]


def test_exclude_ignores_free_suffix(tmp_path):
    kit = make_router(tmp_path)
    with pytest.raises(AllProvidersFailed) as exc:
        asyncio.run(
            kit.router.ask(LANE, user("r"), exclude_models=["small-a", "mid-b", "big-c"])
        )
    assert all(a.outcome == "skipped" for a in exc.value.attempts)
    assert kit.fake.calls == []


def test_provider_without_keys_is_skipped(tmp_path):
    kit = make_router(tmp_path, groq_api_keys="")
    response = asyncio.run(kit.router.ask(LANE, user("hi")))
    assert response.model == "mid-b"
    groq = next(p for p in kit.router.status().providers if p.name == "groq")
    assert groq.state == "no_keys"


def test_tool_calls_are_returned(tmp_path):
    kit = make_router(tmp_path)
    call = {"id": "t1", "type": "function",
            "function": {"name": "read_file", "arguments": '{"path": "a.py"}'}}
    kit.fake.on("small-a", ok("", tool_calls=[call]))
    tools = [{"type": "function", "function": {"name": "read_file", "parameters": {}}}]
    response = asyncio.run(kit.router.ask(LANE, user("hi"), tools=tools))
    assert response.tool_calls[0].name == "read_file"
    assert kit.fake.calls[0].body["tools"] == tools


def test_unknown_lane_is_an_error(tmp_path):
    kit = make_router(tmp_path)
    with pytest.raises(LLMError, match="Unknown lane"):
        asyncio.run(kit.router.ask("nope", user("hi")))


def test_sdk_retries_are_off(tmp_path):
    kit = make_router(tmp_path, entries=[LaneEntry(provider="groq", model="m", max_context=8000)])
    kit.fake.on("m", error(429))
    with pytest.raises(AllProvidersFailed):
        asyncio.run(kit.router.ask(LANE, user("hi")))
    assert len(kit.fake.calls) == 1


SIGNED_CALL = {"id": "t1", "type": "function",
               "function": {"name": "read_file", "arguments": "{}"},
               "extra_content": {"google": {"thought_signature": "sig123"}}}


def test_tool_call_extra_content_is_kept(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", ok("", tool_calls=[SIGNED_CALL]))
    response = asyncio.run(kit.router.ask(LANE, user("hi")))
    assert response.tool_calls[0].extra_content == {"google": {"thought_signature": "sig123"}}


def test_extra_content_only_goes_to_gemini(tmp_path):
    history = [*user("hi"), {"role": "assistant", "content": None, "tool_calls": [SIGNED_CALL]},
               {"role": "tool", "tool_call_id": "t1", "content": "result"}]
    gemini = LaneEntry(provider="gemini", model="gem", max_context=8_000)
    kit = make_router(tmp_path, entries=[gemini, ENTRIES[0]], gemini_api_keys="AIzaG111")
    kit.fake.on("gem", error(429))  # forces the fallback to groq mid-conversation
    asyncio.run(kit.router.ask(LANE, history))

    sent_to = {c.provider: c.body["messages"][1]["tool_calls"][0] for c in kit.fake.calls}
    assert sent_to["gemini"]["extra_content"] == {"google": {"thought_signature": "sig123"}}
    assert "extra_content" not in sent_to["groq"]
