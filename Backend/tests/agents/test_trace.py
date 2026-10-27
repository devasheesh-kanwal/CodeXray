"""agent_trace built from run events, in the Prompt 1 AgentTraceStep shape."""

import asyncio

from app.agents.trace import build_agent_trace
from app.api.schemas.common import AgentTraceStep
from app.api.schemas.qa import AskResponse
from tests.agents.fakes import final, finder, make_kit, tool_call

ANSWER = {"files": ["shop/db.py"], "reason": "storage"}


def test_trace_from_a_real_agent_run(tmp_path, ctx):
    kit = make_kit(tmp_path)
    kit.fake.on("m1", tool_call("search_code", {"query": "save"}), tool_call("write_patch", {"diff": "x"},
                "c2"), final(ANSWER))
    asyncio.run(finder(kit, ctx).run({"question": "q"}, ctx.state))
    ctx.state.emit("agent_output", "3 of 3 citations verified", agent="citation_checker", ms=4)

    trace = build_agent_trace(ctx.state)

    assert [(t.agent, t.step, t.action) for t in trace] == [
        ("finder", 1, "search_code"),
        ("finder", 2, "write_patch"),
        ("finder", 3, "output"),
        ("citation_checker", 4, "output"),
    ]
    assert trace[0].summary == "2 results (bm25_only); top shop/db.py:13-14"
    assert trace[1].summary == "refused: write_patch not allowed"
    assert all(isinstance(t, AgentTraceStep) and t.ms >= 0 for t in trace)


def test_trace_fits_the_existing_api_field(tmp_path, ctx):
    ctx.state.emit("agent_error", "finder failed: timeout", agent="finder")
    trace = build_agent_trace(ctx.state)
    response = AskResponse(answer="x", citations=[], confidence=0.5, not_found=False,
                           provider="groq", model="m", cached=False, agent_trace=trace)
    assert response.model_dump()["agent_trace"] == [
        {"agent": "finder", "step": 1, "action": "error", "summary": "finder failed: timeout", "ms": 0}
    ]


def test_events_without_a_trace_meaning_are_skipped(ctx):
    ctx.state.emit("state_change", "-> FIND", state="FIND")
    ctx.state.emit("agent_started", "finder started", agent="finder")
    ctx.state.emit("tool_call", "search_code(...)", agent="finder")
    assert build_agent_trace(ctx.state) == []
