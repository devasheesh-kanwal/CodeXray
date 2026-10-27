"""ask_json: fences, validation, one retry, InvalidLLMOutput."""

import asyncio

import pytest
from pydantic import BaseModel

from app.llm import DemoCacheMiss, InvalidLLMOutput
from app.llm.jsonout import strip_fences
from tests.llm.fakes import LANE, make_router, ok, user


class Verdict(BaseModel):
    approve: bool
    reason: str


def test_strip_fences():
    assert strip_fences('```json\n{"a": 1}\n```') == '{"a": 1}'
    assert strip_fences('Here you go:\n```\n{"a": 1}\n```\nThanks') == '{"a": 1}'
    assert strip_fences('  {"a": 1} ') == '{"a": 1}'


def test_valid_fenced_json_is_parsed(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", ok('```json\n{"approve": true, "reason": "fine"}\n```'))
    verdict, response = asyncio.run(kit.router.ask_json(LANE, user("ok?"), Verdict))
    assert verdict == Verdict(approve=True, reason="fine")
    assert response.model == "small-a"


def test_schema_instruction_is_sent(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", ok('{"approve": true, "reason": "x"}'))
    asyncio.run(kit.router.ask_json(LANE, user("ok?"), Verdict))
    system = kit.fake.calls[0].body["messages"][0]
    assert system["role"] == "system" and '"approve"' in system["content"]
    assert kit.fake.calls[0].body["temperature"] == 0.1


def test_bad_json_is_retried_once_with_the_error(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on(
        "small-a",
        ok('{"approve": "maybe"}'),
        ok('{"approve": false, "reason": "tests fail"}'),
    )
    verdict, _ = asyncio.run(kit.router.ask_json(LANE, user("ok?"), Verdict))

    assert verdict.approve is False
    assert len(kit.fake.calls) == 2
    retry = kit.fake.calls[1].body["messages"]
    assert retry[-2] == {"role": "assistant", "content": '{"approve": "maybe"}'}
    assert "reason" in retry[-1]["content"]  # names the missing field


def test_bad_json_twice_raises(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", ok("I think it looks good!"))
    with pytest.raises(InvalidLLMOutput) as exc:
        asyncio.run(kit.router.ask_json(LANE, user("ok?"), Verdict))
    assert len(kit.fake.calls) == 2
    assert exc.value.raw == "I think it looks good!"


def test_only_valid_json_is_cached(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", ok("not json"))
    with pytest.raises(InvalidLLMOutput):
        asyncio.run(kit.router.ask_json(LANE, user("ok?"), Verdict))

    demo = make_router(tmp_path, demo_mode=True)
    with pytest.raises(DemoCacheMiss):
        asyncio.run(demo.router.ask_json(LANE, user("ok?"), Verdict))

    kit.fake.on("small-a", ok('{"approve": true, "reason": "x"}'))
    asyncio.run(kit.router.ask_json(LANE, user("ok?"), Verdict))
    verdict, response = asyncio.run(demo.router.ask_json(LANE, user("ok?"), Verdict))
    assert verdict.approve and response.cached
