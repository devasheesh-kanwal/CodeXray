"""Mock SSE streams for /ask/stream and /api/repairs/{run_id}/events."""

import asyncio
from collections.abc import AsyncIterator

from app.api.schemas.qa import AgentEvent, AskResponse, FinalEvent, TokenEvent
from app.api.schemas.repair import FINAL_STATES
from app.api.sse import sse_event
from app.mocks.loader import get_fixture
from app.mocks.repair_sim import MockRepairStore

WORDS_PER_TOKEN = 3
TOKEN_DELAY_S = 0.05
AGENT_DELAY_S = 0.4
REPAIR_POLL_S = 0.5


async def pause(seconds: float) -> None:
    """Wait between events. Tests replace this to run instantly."""
    await asyncio.sleep(seconds)


async def mock_ask_stream() -> AsyncIterator[str]:
    """2 agent events, the answer as tokens, then final and done."""
    ask: AskResponse = get_fixture("ask")

    for agent in ("architect", "explainer"):
        yield sse_event("agent", AgentEvent(agent=agent, status="running"))
        await pause(AGENT_DELAY_S)

    words = ask.answer.split(" ")
    for i in range(0, len(words), WORDS_PER_TOKEN):
        chunk = " ".join(words[i : i + WORDS_PER_TOKEN])
        text = chunk if i + WORDS_PER_TOKEN >= len(words) else chunk + " "
        yield sse_event("token", TokenEvent(text=text))
        await pause(TOKEN_DELAY_S)

    final = FinalEvent(
        citations=ask.citations,
        confidence=ask.confidence,
        not_found=ask.not_found,
        provider=ask.provider,
        model=ask.model,
        agent_trace=ask.agent_trace or [],
    )
    yield sse_event("final", final)
    yield sse_event("done", {})


async def mock_repair_events(store: MockRepairStore, run_id: str) -> AsyncIterator[str]:
    """Replay past events, then send new ones until the run waits or ends."""
    sent = 0
    while True:
        run = store.snapshot(run_id)
        for event in run.events[sent:]:
            yield sse_event("repair_event", event)
        sent = len(run.events)
        if run.state == "AWAITING_APPROVAL" or run.state in FINAL_STATES:
            yield sse_event("done", {"state": run.state})
            return
        await pause(REPAIR_POLL_S)
