"""PR review: /api/repos/{repo_id}/review."""

from fastapi import APIRouter, Depends

from app.api.deps import get_settings
from app.api.schemas.review import ReviewRequest, ReviewResponse
from app.config import Settings
from app.errors import not_implemented
from app.mocks.loader import get_fixture

router = APIRouter(prefix="/api/repos", tags=["review"])


@router.post("/{repo_id}/review", response_model=ReviewResponse)
def review(
    repo_id: str, body: ReviewRequest, settings: Settings = Depends(get_settings)
) -> ReviewResponse:
    """Review a diff (diff_text) or the difference between two branches."""
    if not settings.mock_mode:
        raise not_implemented("PR review", "5")
    return get_fixture("review")
