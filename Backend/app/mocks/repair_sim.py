"""In-memory mock repair runs that follow fixtures/repair_script.json over ~20 s.

A run only stores its start time. Its state is worked out on each request from
how many script steps are due, so no background task is needed.
"""

import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.api.schemas.repair import RepairEvent, RepairRun
from app.errors import ApiError, not_found
from app.mocks.loader import get_fixture
from app.mocks.models import RepairScript


@dataclass
class MockRun:
    run_id: str
    issue: str
    started_clock: float
    started_at: datetime
    decision: RepairEvent | None = None


class MockRepairStore:
    """Holds mock runs. `clock` is injectable so tests can skip the 20 s wait."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self.runs: dict[str, MockRun] = {}

    def create(self, issue: str) -> str:
        run_id = "run_" + uuid.uuid4().hex[:8]
        self.runs[run_id] = MockRun(
            run_id=run_id,
            issue=issue,
            started_clock=self.clock(),
            started_at=datetime.now(UTC),
        )
        return run_id

    def snapshot(self, run_id: str) -> RepairRun:
        """The run as it looks right now."""
        run = self._get(run_id)
        script: RepairScript = get_fixture("repair_script")
        elapsed = self.clock() - run.started_clock

        fields: dict = {}
        events: list[RepairEvent] = []
        for step in script.steps:
            if step.at_s > elapsed:
                break
            data = dict(step.data)
            if step.state == "CREATED":
                data["issue"] = run.issue
            events.append(
                RepairEvent(
                    ts=run.started_at + timedelta(seconds=step.at_s),
                    state=step.state,
                    attempt=step.attempt,
                    agent=step.agent,
                    kind=step.kind,
                    message=step.message,
                    data=data,
                )
            )
            fields.update(step.sets.model_dump(exclude_unset=True))

        if run.decision:
            events.append(run.decision)
        last = events[-1]
        return RepairRun(
            state=last.state,
            attempt=last.attempt,
            max_attempts=script.max_attempts,
            events=events,
            **fields,
        )

    def decide(self, run_id: str, approve: bool) -> RepairRun:
        """Approve (-> MERGED) or reject (-> REJECTED) a run awaiting approval."""
        current = self.snapshot(run_id)
        if current.state != "AWAITING_APPROVAL":
            raise ApiError(
                409,
                "INVALID_STATE",
                f"Run is {current.state}; it can only be approved or rejected "
                "in AWAITING_APPROVAL",
                {"run_id": run_id, "state": current.state},
            )
        branch = "codexray/repair-2"
        if approve:
            state, message = "MERGED", f"Approved by user; {branch} merged locally (not pushed)."
        else:
            state, message = "REJECTED", f"Rejected by user; {branch} deleted."
        self._get(run_id).decision = RepairEvent(
            ts=datetime.now(UTC),
            state=state,
            attempt=current.attempt,
            agent="coordinator",
            kind="state",
            message=message,
            data={"branch": branch},
        )
        return self.snapshot(run_id)

    def _get(self, run_id: str) -> MockRun:
        if run_id not in self.runs:
            raise not_found("Repair run", run_id=run_id)
        return self.runs[run_id]
