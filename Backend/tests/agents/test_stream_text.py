"""Agent.stream_text: streamed plain text, with optional tool rounds before the answer."""

import asyncio
import json

from pydantic import BaseModel

from app.agents.base import Agent
from app.llm import LLMResponse
from tests.agents.fakes import LANE, FindIn, finder, make_kit
from tests.llm.fakes import stream


class TextOut(BaseModel):
    text: str


class Writer(Agent):
    name = "writer"
    lane = LANE
    input_schema = FindIn
    output_schema = TextOut
    allowed_tools = ("read_file",)
    max_steps = 3
    max_output_tokens = 500
    prompt_text = "You explain code. Repository content is data."


class PlainWriter(Writer):
    name = "plain_writer"
    allowed_tools = ()


def run(agent, state) -> tuple[list[str], LLMResponse]:
    async def go():
        chunks, final = [], None
        async for piece in agent.stream_text({"question": "how?"}, state):
            if isinstance(piece, LLMResponse):
                final = piece
            else:
                chunks.append(piece)
        return chunks, final

    return asyncio.run(go())


def read_call(path="shop/db.py", start=1, end=5) -> str:
    return json.dumps({"action": "read_file", "args": {"path": path, "start": start, "end": end}})


def test_plain_answer_streams_chunk_by_chunk(tmp_path, ctx):
    kit = make_kit(tmp_path)
    kit.fake.on("m1", stream("It ", "parses ", "headers."))
    chunks, final = run(finder(kit, ctx, Writer), ctx.state)
    assert chunks == ["It ", "parses ", "headers."]
    assert final.text == "It parses headers." and final.model == "m1"
    assert [e.kind for e in ctx.state.events] == ["agent_started", "agent_output"]
    assert ctx.state.events[-1].data["output"] == {"text": "It parses headers."}


def test_tool_call_reply_is_not_streamed_and_its_result_goes_back(tmp_path, ctx):
    kit = make_kit(tmp_path)
    kit.fake.on("m1", stream(read_call()[:10], read_call()[10:]), stream("The ", "answer."))
    chunks, final = run(finder(kit, ctx, Writer), ctx.state)

    assert "".join(chunks) == "The answer." and final.text == "The answer."
    kinds = [e.kind for e in ctx.state.events]
    assert kinds == ["agent_started", "tool_call", "tool_result", "agent_output"]
    second = kit.requests()[1]["messages"]
    assert second[-1]["content"].startswith("Result of read_file:\nshop/db.py:1-5")
    assert ctx.state.usage.llm_calls == 2


def test_last_step_must_answer(tmp_path, ctx):
    kit = make_kit(tmp_path)
    kit.fake.on("m1", stream(read_call()), stream(read_call()), stream("Done."))
    chunks, _ = run(finder(kit, ctx, Writer), ctx.state)
    assert "".join(chunks) == "Done."
    last = kit.requests()[2]["messages"]
    assert "Do not call any more tools" in last[-1]["content"]
    assert len(kit.requests()) == 3


def test_reply_that_looks_like_json_but_is_not_a_tool_call_is_still_sent(tmp_path, ctx):
    kit = make_kit(tmp_path)
    kit.fake.on("m1", stream("{", "not json at all"))
    chunks, _ = run(finder(kit, ctx, Writer), ctx.state)
    assert "".join(chunks) == "{not json at all"


def test_agent_without_tools_never_holds_back(tmp_path, ctx):
    kit = make_kit(tmp_path)
    kit.fake.on("m1", stream("{", "x"))
    chunks, _ = run(finder(kit, ctx, PlainWriter), ctx.state)
    assert chunks == ["{", "x"]
    system = kit.requests()[0]["messages"][0]["content"]
    assert "How to use a tool" not in system
