"""Repair loop: start a run, poll it, stream its events, approve or reject."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.api.deps import get_settings
from app.api.schemas.repair import RepairRequest, RepairRun, RepairStarted
from app.api.sse import SSE_RESPONSE_DOC, sse_response
from app.config import Settings
from app.errors import not_implemented
from app.mocks.repair_sim import MockRepairStore
from app.mocks.streams import mock_repair_events

router = APIRouter(prefix="/api", tags=["repair"])


def get_mock_runs(request: Request) -> MockRepairStore:
    return request.app.state.repair_runs


@router.post("/repos/{repo_id}/repair", response_model=RepairStarted, status_code=202)
def start_repair(
    repo_id: str,
    body: RepairRequest,
    settings: Settings = Depends(get_settings),
    runs: MockRepairStore = Depends(get_mock_runs),
) -> RepairStarted:
    if not settings.mock_mode:
        raise not_implemented("Repair loop", "6")
    return RepairStarted(run_id=runs.create(body.issue))


@router.get("/repairs/{run_id}", response_model=RepairRun)
def get_repair(
    run_id: str,
    settings: Settings = Depends(get_settings),
    runs: MockRepairStore = Depends(get_mock_runs),
) -> RepairRun:
    if not settings.mock_mode:
        raise not_implemented("Repair loop", "6")
    return runs.snapshot(run_id)


@router.get(
    "/repairs/{run_id}/events",
    response_class=StreamingResponse,
    responses=SSE_RESPONSE_DOC,
)
def repair_events(
    run_id: str,
    settings: Settings = Depends(get_settings),
    runs: MockRepairStore = Depends(get_mock_runs),
) -> StreamingResponse:
    """SSE: every past event, then new ones, until AWAITING_APPROVAL or a final state."""
    if not settings.mock_mode:
        raise not_implemented("Repair loop", "6")
    runs.snapshot(run_id)  # 404 as JSON before the stream starts
    return sse_response(mock_repair_events(runs, run_id))


@router.post("/repairs/{run_id}/approve", response_model=RepairRun)
def approve_repair(
    run_id: str,
    settings: Settings = Depends(get_settings),
    runs: MockRepairStore = Depends(get_mock_runs),
) -> RepairRun:
    if not settings.mock_mode:
        raise not_implemented("Repair loop", "6")
    return runs.decide(run_id, approve=True)


@router.post("/repairs/{run_id}/reject", response_model=RepairRun)
def reject_repair(
    run_id: str,
    settings: Settings = Depends(get_settings),
    runs: MockRepairStore = Depends(get_mock_runs),
) -> RepairRun:
    if not settings.mock_mode:
        raise not_implemented("Repair loop", "6")
    return runs.decide(run_id, approve=False)
