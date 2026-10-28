"""LLM endpoints: provider health and recent calls, the model list, and picking a model.

GET /api/llm/status, GET /api/llm/models, PUT /api/llm/selection
"""

from fastapi import APIRouter, Depends, Request

from app.api.deps import get_settings
from app.api.schemas.llm import LlmStatus, ModelsResponse, SelectionRequest
from app.config import Settings
from app.errors import ApiError
from app.mocks.loader import get_fixture

router = APIRouter(prefix="/api/llm", tags=["llm"])


@router.get("/status", response_model=LlmStatus)
def llm_status(request: Request, settings: Settings = Depends(get_settings)) -> LlmStatus:
    """Provider states and the last 50 LLM calls (oldest first)."""
    if settings.mock_mode:
        return get_fixture("llm_status")
    return request.app.state.llm_router.status()


@router.get("/models", response_model=ModelsResponse)
def llm_models(request: Request, settings: Settings = Depends(get_settings)) -> ModelsResponse:
    """Every model the agents can use, its state right now, and the current selection."""
    if settings.mock_mode:
        return _mock_models(request)
    return request.app.state.llm_router.models()


@router.put("/selection", response_model=ModelsResponse)
def llm_selection(
    body: SelectionRequest, request: Request, settings: Settings = Depends(get_settings)
) -> ModelsResponse:
    """Pick the model every agent tries first (null = automatic). Falls back if it fails."""
    if settings.mock_mode:
        known = {m.id for m in get_fixture("llm_models").models}
        _check_known(body.model, known)
        request.app.state.mock_model_selection = body.model
        return _mock_models(request)
    router_ = request.app.state.llm_router
    _check_known(body.model, set(router_.catalog()))
    router_.select(body.model)
    return router_.models()


def _check_known(model: str | None, known: set[str]) -> None:
    if model is not None and model not in known:
        raise ApiError(422, "VALIDATION_ERROR", f"Unknown model '{model}'", {"known": sorted(known)})


def _mock_models(request: Request) -> ModelsResponse:
    selected = getattr(request.app.state, "mock_model_selection", None)
    return get_fixture("llm_models").model_copy(
        update={"mode": "manual" if selected else "auto", "selected": selected})
