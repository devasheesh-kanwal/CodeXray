"""Coordinator: state machine, budgets, events in order, resume from disk."""

import asyncio

from app.agents.coordinator import Coordinator, Workflow
from app.agents.state import Budget, RunState
from tests.agents.fakes import final, finder, make_kit, tool_call

ANSWER = {"files": ["shop/db.py"], "reason": "storage"}


class FindWorkflow(Workflow):
    """FIND (agent) -> CHECK (plain code) -> DONE."""

    kind = "qa"
    start = "FIND"
    final_states = frozenset({"DONE"})

    def __init__(self, agent):
        self.agent = agent

    def handlers(self):
        return {"FIND": self.find, "CHECK": self.check}

    async def find(self, state: RunState) -> str:
        output = await self.agent.run({"question": state.inputs["question"]}, state)
        state.artifacts["selected_code"] = output.model_dump()
        return "CHECK"

    async def check(self, state: RunState) -> str:
        state.artifacts["notes"].append("checked")
        return "DONE"


def setup(tmp_path, ctx, *replies, budget=None):
    kit = make_kit(tmp_path)
    kit.fake.on("m1", *replies)
    coordinator = Coordinator(tmp_path / "runs")
    workflow = FindWorkflow(finder(kit, ctx))
    state = coordinator.new_run(workflow, ctx.repo_id, {"question": "where?"}, budget)
    ctx.state = state  # tools see the same run
    return coordinator, workflow, state


def test_workflow_runs_to_its_final_state(tmp_path, ctx):
    coordinator, workflow, state = setup(
        tmp_path, ctx, tool_call("search_code", {"query": "save"}), final(ANSWER))
    asyncio.run(coordinator.run(workflow, state))

    assert state.status == "done" and state.machine_state == "DONE"
    assert state.artifacts["selected_code"] == ANSWER
    assert state.artifacts["notes"] == ["checked"]
    assert [e.kind for e in state.events] == [
        "state_change", "agent_started", "tool_call", "tool_result", "agent_output",
        "state_change", "state_change", "run_finished",
    ]
    assert [e.seq for e in state.events] == list(range(1, 9))
    assert [e.data["state"] for e in state.events if e.kind == "state_change"] == ["FIND", "CHECK", "DONE"]


def test_llm_call_budget_stops_the_run_with_a_reason(tmp_path, ctx):
    coordinator, workflow, state = setup(
        tmp_path, ctx, tool_call("search_code", {"query": "x"}), final(ANSWER),
        budget=Budget(max_llm_calls=1))
    asyncio.run(coordinator.run(workflow, state))
    assert state.status == "stopped"
    assert state.stop_reason == "LLM call budget used up (1 calls)"
    assert state.events[-1].kind == "run_finished"
    assert state.events[-1].data["status"] == "stopped"


def test_token_budget(tmp_path, ctx):
    coordinator, workflow, state = setup(
        tmp_path, ctx, tool_call("search_code", {"query": "x"}), final(ANSWER),
        budget=Budget(max_tokens=10))  # each fake reply reports 13 tokens
    asyncio.run(coordinator.run(workflow, state))
    assert state.status == "stopped" and "token budget" in state.stop_reason


def test_wall_clock_budget(tmp_path, ctx):
    class SlowWorkflow(FindWorkflow):
        async def find(self, state):
            await asyncio.sleep(5)
            return "DONE"

    coordinator = Coordinator(tmp_path / "runs")
    workflow = SlowWorkflow(None)
    state = coordinator.new_run(workflow, ctx.repo_id, {}, Budget(max_seconds=0.2))
    asyncio.run(coordinator.run(workflow, state))
    assert state.status == "stopped" and state.stop_reason == "time budget used up (0 s)"


def test_a_failing_step_fails_the_run(tmp_path, ctx):
    class Broken(FindWorkflow):
        async def check(self, state):
            raise RuntimeError("disk full")

    coordinator, workflow, state = setup(tmp_path, ctx, final(ANSWER))
    asyncio.run(coordinator.run(Broken(workflow.agent), state))
    assert state.status == "failed" and state.stop_reason == "RuntimeError: disk full"
    assert state.machine_state == "CHECK"


def test_run_state_resumes_from_disk(tmp_path, ctx):
    coordinator, workflow, state = setup(tmp_path, ctx, final(ANSWER))
    asyncio.run(coordinator.run(workflow, state))

    fresh = Coordinator(tmp_path / "runs")  # e.g. after a page refresh / new request
    loaded = fresh.load(state.run_id)
    assert loaded.model_dump() == state.model_dump()

    async def replay():
        return [e.kind async for e in fresh.bus.subscribe(loaded.run_id, list(loaded.events))]

    fresh.bus.close(loaded.run_id)
    assert asyncio.run(asyncio.wait_for(replay(), 1)) == [e.kind for e in state.events]


def test_live_subscriber_sees_events_in_order(tmp_path, ctx):
    coordinator, workflow, state = setup(
        tmp_path, ctx, tool_call("search_code", {"query": "x"}), final(ANSWER))

    async def scenario():
        seen = []

        async def listen():
            async for event in coordinator.bus.subscribe(state.run_id, []):
                seen.append(event.seq)

        listener = asyncio.create_task(listen())
        await asyncio.sleep(0)
        await coordinator.run(workflow, state)
        await asyncio.wait_for(listener, 1)
        return seen

    assert asyncio.run(scenario()) == list(range(1, len(state.events) + 1))
