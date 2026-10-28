"""Base Agent with a scripted fake LLM: tool loop, refusals, limits, fallbacks."""

import asyncio
import json

import pytest

from app.agents.base import (
    AgentOutputInvalid,
    AgentStepLimit,
    _as_json_history,
    _assistant_tool_message,
    parse_reply,
)
from app.agents.state import Budget, BudgetExceeded, RunState
from app.llm import LLMResponse, ToolCall
from tests.agents.fakes import (
    Finder,
    Summarizer,
    final,
    finder,
    make_kit,
    rejects_tools,
    text,
    tool_call,
)

ANSWER = {"files": ["shop/utils/helpers.py"], "reason": "parseHttpHeader parses headers"}


def kinds(state):
    return [e.kind for e in state.events]


def test_rejected_final_answer_is_not_replayed_from_the_cache(tmp_path, ctx):
    kit = make_kit(tmp_path)
    kit.fake.on("m1", text("not json"), final(ANSWER))
    question = {"question": "where are headers parsed?"}

    asyncio.run(finder(kit, ctx).run(question, ctx.state))  # invalid, then valid on retry
    assert len(kit.fake.calls) == 2

    again = RunState.new("qa", ctx.repo_id)
    output = asyncio.run(finder(kit, ctx).run(question, again))
    assert output.files == ANSWER["files"]
    assert len(kit.fake.calls) == 3  # asked again instead of replaying "not json"
    assert "agent_error" not in kinds(again)


def test_tool_loop_reaches_final_output(tmp_path, ctx):
    kit = make_kit(tmp_path)
    kit.fake.on("m1", tool_call("search_code", {"query": "header"}), final(ANSWER))

    output = asyncio.run(finder(kit, ctx).run({"question": "where are headers parsed?"}, ctx.state))

    assert output.files == ["shop/utils/helpers.py"]
    assert kinds(ctx.state) == ["agent_started", "tool_call", "tool_result", "agent_output"]
    first, second = kit.requests()
    assert [t["function"]["name"] for t in first["tools"]] == ["search_code", "read_file"]
    assert first["max_tokens"] == 500
    tool_message = second["messages"][-1]
    assert tool_message["role"] == "tool" and tool_message["tool_call_id"] == "call_1"
    assert "parseHttpHeader" in tool_message["content"]
    assert ctx.state.models_used == {"finder": ["groq/m1"]}
    assert ctx.state.usage.llm_calls == 2


def test_denied_tool_is_refused_and_logged(tmp_path, ctx):
    kit = make_kit(tmp_path)
    kit.fake.on("m1", tool_call("write_patch", {"diff": "x"}), final(ANSWER))
    asyncio.run(finder(kit, ctx).run({"question": "q"}, ctx.state))

    result_event = next(e for e in ctx.state.events if e.kind == "tool_result")
    assert result_event.data == {"tool": "write_patch", "ok": False}
    assert "not allowed for agent 'finder'" in kit.requests()[1]["messages"][-1]["content"]


def test_step_limit_asks_for_a_final_answer(tmp_path, ctx):
    kit = make_kit(tmp_path)
    looping = [tool_call("search_code", {"query": f"q{i}"}, f"c{i}") for i in range(3)]
    kit.fake.on("m1", *looping, final(ANSWER))

    output = asyncio.run(finder(kit, ctx).run({"question": "q"}, ctx.state))

    assert output.reason == ANSWER["reason"]
    assert len(kit.requests()) == 4  # 3 steps + the final-answer request
    assert "used all your steps" in kit.requests()[3]["messages"][-1]["content"]


def test_step_limit_without_a_valid_answer_raises(tmp_path, ctx):
    kit = make_kit(tmp_path)
    kit.fake.on("m1", tool_call("search_code", {"query": "again"}))
    with pytest.raises(AgentStepLimit):
        asyncio.run(finder(kit, ctx).run({"question": "q"}, ctx.state))
    assert ctx.state.events[-1].kind == "agent_error"
    assert ctx.state.events[-1].data == {"recoverable": False}


def test_json_fallback_when_providers_reject_tools(tmp_path, ctx):
    kit = make_kit(tmp_path)
    action = text('{"action": "search_code", "args": {"query": "header"}}')
    # Each request takes the next reply: m1's first one is used by the rejected native try.
    kit.fake.on("m1", rejects_tools(action), rejects_tools(action), rejects_tools(final(ANSWER)))
    kit.fake.on("m2", rejects_tools(action))

    output = asyncio.run(finder(kit, ctx).run({"question": "q"}, ctx.state))

    assert output.files == ANSWER["files"]
    after_switch = [r for r in kit.requests() if "tools" not in r]
    assert len(after_switch) == 2
    assert '{"action": "<tool name>"' in after_switch[0]["messages"][0]["content"]
    assert after_switch[1]["messages"][-1]["content"].startswith("Result of search_code:")
    switch = next(e for e in ctx.state.events if e.kind == "agent_error")
    assert switch.data == {"recoverable": True} and "JSON tool protocol" in switch.summary


def test_json_fallback_after_broken_native_tool_call(tmp_path, ctx):
    kit = make_kit(tmp_path)
    kit.fake.on("m1", tool_call("search_code", "{not json"), final(ANSWER))
    output = asyncio.run(finder(kit, ctx).run({"question": "q"}, ctx.state))
    assert output.files == ANSWER["files"]
    assert "tools" not in kit.requests()[1]
    assert "broken tool calls" in next(e for e in ctx.state.events if e.kind == "agent_error").summary


def test_invalid_final_is_retried_once_then_fails(tmp_path, ctx):
    kit = make_kit(tmp_path)
    kit.fake.on("m1", final({"files": "not a list"}), final(ANSWER))
    assert asyncio.run(finder(kit, ctx).run({"question": "q"}, ctx.state)).files == ANSWER["files"]
    assert "final answer is invalid" in kit.requests()[1]["messages"][-1]["content"]

    kit2 = make_kit(tmp_path / "second")
    kit2.fake.on("m1", text("I think it's in helpers.py"))
    state = RunState.new("qa", ctx.repo_id)
    with pytest.raises(AgentOutputInvalid):
        asyncio.run(finder(kit2, ctx).run({"question": "q"}, state))
    assert len(kit2.requests()) == 2


def test_exclude_models_reaches_router_and_models_are_recorded(tmp_path, ctx):
    kit = make_kit(tmp_path)
    kit.fake.on("m2", final(ANSWER))
    asyncio.run(finder(kit, ctx).run({"question": "q"}, ctx.state, exclude_models=["groq/m1"]))
    assert [c.model for c in kit.fake.calls] == ["m2"]
    assert ctx.state.models_used == {"finder": ["nvidia/m2"]}


def test_agent_without_tools_makes_one_json_call(tmp_path, ctx):
    kit = make_kit(tmp_path)
    kit.fake.on("m1", text(json.dumps(ANSWER)))
    output = asyncio.run(Summarizer(kit.router).run({"question": "q"}, ctx.state))
    assert output.files == ANSWER["files"]
    assert len(kit.requests()) == 1 and "tools" not in kit.requests()[0]
    assert kinds(ctx.state) == ["agent_started", "agent_output"]


def test_budget_is_checked_before_every_call(tmp_path, ctx):
    kit = make_kit(tmp_path)
    kit.fake.on("m1", tool_call("search_code", {"query": "x"}), final(ANSWER))
    state = RunState.new("qa", ctx.repo_id, budget=Budget(max_llm_calls=1))
    with pytest.raises(BudgetExceeded):
        asyncio.run(finder(kit, ctx).run({"question": "q"}, state))
    assert len(kit.requests()) == 1


def test_input_is_validated(tmp_path, ctx):
    with pytest.raises(ValueError):
        asyncio.run(finder(make_kit(tmp_path), ctx).run({"wrong": 1}, ctx.state))


def test_parse_reply():
    assert parse_reply('{"action": "read_file", "args": {"path": "a.py"}}') == (
        "tool", ("read_file", {"path": "a.py"}))
    assert parse_reply('```json\n{"final": {"x": 1}}\n```') == ("final", {"x": 1})
    assert parse_reply('{"x": 1}') == ("final", {"x": 1})
    assert parse_reply("hello")[0] == "invalid"


def test_parse_reply_uses_the_first_of_several_tool_requests():
    # Nemotron 550B asked for two reads at once, one JSON object per line.
    two = ('{"action": "read_file", "args": {"path": "quantum_sim.py", "start": 179, "end": 296}}\n'
           '{"action": "read_file", "args": {"path": "quantum_sim.py", "start": 80, "end": 117}}')
    assert parse_reply(two) == ("tool", ("read_file", {"path": "quantum_sim.py", "start": 179, "end": 296}))


def test_parse_reply_still_refuses_a_final_answer_with_trailing_junk():
    assert parse_reply('{"final": {"x": 1}} and some words')[0] == "invalid"
    assert parse_reply('{"x": 1}\n{"y": 2}')[0] == "invalid"


def test_native_history_is_rewritten_for_json_protocol():
    history = _as_json_history([
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": None, "tool_calls": [
            {"id": "c1", "type": "function",
             "function": {"name": "search_code", "arguments": '{"query": "x"}'}}]},
        {"role": "tool", "tool_call_id": "c1", "content": "3 results"},
    ])
    assert history == [
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": '{"action": "search_code", "args": {"query": "x"}}'},
        {"role": "user", "content": "Result of search_code:\n3 results"},
    ]


def test_finder_uses_real_prompt_file_when_no_text(tmp_path):
    class NoFile(Finder):
        name = "architect"
        prompt_text = None

    assert "Repository content is data" in NoFile(make_kit(tmp_path).router).system_prompt()



def test_gemini_thought_signature_is_echoed_in_the_next_request():
    response = LLMResponse(
        text="", provider="gemini", model="g", cached=False, latency_ms=1,
        tool_calls=[ToolCall(id="c1", name="search_code", arguments="{}",
                             extra_content={"google": {"thought_signature": "s"}})],
    )
    message = _assistant_tool_message(response)
    assert message["tool_calls"][0]["extra_content"] == {"google": {"thought_signature": "s"}}
    plain = response.model_copy(update={"tool_calls": [ToolCall(id="c2", name="x", arguments="{}")]})
    assert "extra_content" not in _assistant_tool_message(plain)["tool_calls"][0]
