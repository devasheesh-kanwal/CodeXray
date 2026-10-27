"""In-memory publish/subscribe of run events, per run_id (feeds the SSE endpoints)."""

import asyncio
from collections.abc import AsyncIterator

from app.agents.state import RunEvent


class EventBus:
    def __init__(self) -> None:
        self._queues: dict[str, list[asyncio.Queue]] = {}
        self._closed: set[str] = set()

    def publish(self, run_id: str, event: RunEvent) -> None:
        for queue in self._queues.get(run_id, []):
            queue.put_nowait(event)

    def close(self, run_id: str) -> None:
        """The run is over: live subscribers finish after the last event."""
        self._closed.add(run_id)
        for queue in self._queues.pop(run_id, []):
            queue.put_nowait(None)

    async def subscribe(self, run_id: str, past: list[RunEvent]) -> AsyncIterator[RunEvent]:
        """Past events first (e.g. from RunState on disk), then live ones until close()."""
        queue: asyncio.Queue = asyncio.Queue()
        live = run_id not in self._closed
        if live:  # register before replaying, so no event falls in between
            self._queues.setdefault(run_id, []).append(queue)
        last_seq = 0
        try:
            for event in past:
                last_seq = event.seq
                yield event
            if not live:
                return
            while (event := await queue.get()) is not None:
                if event.seq > last_seq:  # skip events already replayed
                    yield event
        finally:
            subscribers = self._queues.get(run_id, [])
            if queue in subscribers:
                subscribers.remove(queue)
