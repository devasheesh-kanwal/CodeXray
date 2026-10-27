"""RunState persistence, budgets, models_used, and the EventBus."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from app.agents.events import EventBus
from app.agents.state import Budget, BudgetExceeded, RunState


def test_new_run_has_empty_artifacts_and_defaults():
    state = RunState.new("qa", "repo-1", {"question": "q"})
    assert state.run_id.startswith("run_") and state.status == "running"
    assert set(state.artifacts) == {
        "selected_code", "hypothesis", "patch", "test_results", "eval", "notes", "findings",
    }
    assert state.budget == Budget(max_llm_calls=25, max_tokens=200_000, max_seconds=300)


def test_emit_saves_after_every_event_and_reloads(tmp_path):
    state = RunState.new("qa", "repo-1").attach(tmp_path)
    state.emit("agent_started", "architect started", agent="architect", step=0)
    state.emit("tool_call", "search_code('login')", agent="architect", step=1, tool="search_code")

    loaded = RunState.load(tmp_path, state.run_id)
    assert [e.kind for e in loaded.events] == ["agent_started", "tool_call"]
    assert [e.seq for e in loaded.events] == [1, 2]
    assert loaded.events[1].data == {"tool": "search_code"}
    assert RunState.load(tmp_path, "run_000000000000") is None
    assert RunState.load(tmp_path, "../../etc/passwd") is None


def test_models_used_keeps_every_model_once():
    state = RunState.new("repair", "r")
    state.record_model("repair", "groq", "openai/gpt-oss-120b")
    state.record_model("repair", "openrouter", "poolside/laguna-s-2.1:free")
    state.record_model("repair", "groq", "openai/gpt-oss-120b")
    assert state.models_used == {
        "repair": ["groq/openai/gpt-oss-120b", "openrouter/poolside/laguna-s-2.1:free"]
    }


@pytest.mark.parametrize(
    ("budget", "usage", "message"),
    [
        (Budget(max_llm_calls=2), {"llm_calls": 2}, "LLM call budget"),
        (Budget(max_tokens=100), {"tokens": 150}, "token budget"),
    ],
)
def test_budget_checks(budget, usage, message):
    state = RunState.new("qa", "r", budget=budget)
    state.check_budget()  # fine at the start
    for name, value in usage.items():
        setattr(state.usage, name, value)
    with pytest.raises(BudgetExceeded, match=message):
        state.check_budget()


def test_time_budget():
    state = RunState.new("qa", "r", budget=Budget(max_seconds=10))
    state.created_at = datetime.now(UTC) - timedelta(seconds=11)
    with pytest.raises(BudgetExceeded, match="time budget"):
        state.check_budget()


def test_charge_counts_calls_and_tokens():
    state = RunState.new("qa", "r")
    state.charge(100, 20)
    state.charge(0, 0)  # a cache hit
    assert (state.usage.llm_calls, state.usage.tokens) == (2, 120)


def test_bus_replays_past_then_live_events_until_closed():
    async def scenario():
        bus = EventBus()
        state = RunState.new("qa", "r").attach(None, bus)
        state.emit("agent_started", "one")
        received = []

        async def listen():
            async for event in bus.subscribe(state.run_id, list(state.events)):
                received.append(event.summary)

        task = asyncio.create_task(listen())
        await asyncio.sleep(0)
        state.emit("tool_call", "two")
        state.emit("agent_output", "three")
        bus.close(state.run_id)
        await asyncio.wait_for(task, 1)
        return received

    assert asyncio.run(scenario()) == ["one", "two", "three"]


def test_subscribing_to_a_finished_run_only_replays():
    async def scenario():
        bus = EventBus()
        state = RunState.new("qa", "r").attach(None, bus)
        state.emit("agent_started", "one")
        bus.close(state.run_id)
        return [e.summary async for e in bus.subscribe(state.run_id, list(state.events))]

    assert asyncio.run(asyncio.wait_for(scenario(), 1)) == ["one"]
