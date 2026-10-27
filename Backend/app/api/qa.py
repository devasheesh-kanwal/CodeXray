"""Architecture Q&A: /api/repos/{repo_id}/ask and /ask/stream."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.api.deps import get_settings
from app.api.schemas.qa import AskRequest, AskResponse
from app.api.sse import SSE_RESPONSE_DOC, sse_response
from app.config import Settings
from app.mocks.loader import get_fixture
from app.mocks.streams import mock_ask_stream
from app.qa.service import QaService

router = APIRouter(prefix="/api/repos", tags=["qa"])


def get_qa(request: Request) -> QaService:
    return request.app.state.qa_service


@router.post("/{repo_id}/ask", response_model=AskResponse)
async def ask(
    repo_id: str,
    body: AskRequest,
    settings: Settings = Depends(get_settings),
    qa: QaService = Depends(get_qa),
) -> AskResponse:
    """Answer a question about the repo with file:line citations."""
    if settings.mock_mode:
        return get_fixture("ask")
    return await qa.ask(repo_id, body.question)


@router.post(
    "/{repo_id}/ask/stream",
    response_class=StreamingResponse,
    responses=SSE_RESPONSE_DOC,
)
def ask_stream(
    repo_id: str,
    body: AskRequest,
    settings: Settings = Depends(get_settings),
    qa: QaService = Depends(get_qa),
) -> StreamingResponse:
    """Same as /ask, streamed as SSE: agent, token, final, done (or error)."""
    if settings.mock_mode:
        return sse_response(mock_ask_stream())
    qa.check_ready(repo_id)  # 404 / 409 as JSON, before the stream starts
    return sse_response(qa.ask_stream(repo_id, body.question))
