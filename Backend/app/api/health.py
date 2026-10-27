"""GET /api/health"""

from fastapi import APIRouter, Depends

from app import __version__
from app.api.deps import get_settings
from app.api.schemas.common import HealthResponse
from app.config import Settings

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health(settings: Settings = Depends(get_settings)) -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=__version__,
        mock_mode=settings.mock_mode,
        demo_mode=settings.demo_mode,
    )
