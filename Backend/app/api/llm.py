"""GET /api/llm/status: provider health and recent LLM calls."""

from fastapi import APIRouter, Depends, Request

from app.api.deps import get_settings
from app.api.schemas.llm import LlmStatus
from app.config import Settings
from app.mocks.loader import get_fixture

router = APIRouter(prefix="/api/llm", tags=["llm"])


@router.get("/status", response_model=LlmStatus)
def llm_status(request: Request, settings: Settings = Depends(get_settings)) -> LlmStatus:
    """Provider states and the last 50 LLM calls (oldest first)."""
    if settings.mock_mode:
        return get_fixture("llm_status")
    return request.app.state.llm_router.status()
