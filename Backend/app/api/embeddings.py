"""Embedding provider endpoints: which one makes the search vectors, and switching it.

GET /api/embeddings, PUT /api/embeddings/selection
"""

from fastapi import APIRouter, Depends, Request

from app.api.deps import get_settings
from app.api.schemas.embeddings import (
    EmbeddingProvider,
    EmbeddingSelectionRequest,
    EmbeddingsResponse,
)
from app.config import Settings
from app.mocks.loader import get_fixture

router = APIRouter(prefix="/api/embeddings", tags=["embeddings"])


@router.get("", response_model=EmbeddingsResponse)
def embeddings(request: Request, settings: Settings = Depends(get_settings)) -> EmbeddingsResponse:
    """The embedding providers and the one in use."""
    if settings.mock_mode:
        return _mock(request)
    return _response(request, settings)


@router.put("/selection", response_model=EmbeddingsResponse)
async def embedding_selection(
    body: EmbeddingSelectionRequest, request: Request, settings: Settings = Depends(get_settings)
) -> EmbeddingsResponse:
    """Use this provider from now on. Indexed repos get its vectors in the background."""
    if settings.mock_mode:
        request.app.state.mock_embedding_selection = body.provider
        return _mock(request)
    request.app.state.index_service.select_embedding(body.provider)
    return _response(request, settings)


def _response(request: Request, settings: Settings) -> EmbeddingsResponse:
    service = request.app.state.index_service
    return EmbeddingsResponse(
        enabled=settings.embeddings,
        selected=service.embedding_provider,
        providers=[
            EmbeddingProvider(id=name, label=e.label, model=e.model, available=e.available)
            for name, e in service.embedders.items()
        ],
        adding_vectors=sorted(service.adding_vectors),
    )


def _mock(request: Request) -> EmbeddingsResponse:
    fixture = get_fixture("embeddings")
    selected = getattr(request.app.state, "mock_embedding_selection", None) or fixture.selected
    return fixture.model_copy(update={"selected": selected})
