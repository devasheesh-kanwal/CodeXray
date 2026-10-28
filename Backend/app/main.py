"""FastAPI app factory. Run with: uvicorn app.main:app --reload"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import health, llm, qa, repair, repos, review
from app.config import Settings, load_settings
from app.errors import ErrorResponse, register_error_handlers
from app.indexing.service import IndexService
from app.llm import LLMRouter
from app.mocks.repair_sim import MockRepairStore
from app.qa.service import QaService
from app.repair.service import RepairService

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

ERROR_RESPONSES = {
    code: {"model": ErrorResponse} for code in (404, 409, 422, 500, 501)
}
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "Frontend Main" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """At startup, check configured model IDs (only when real API calls are allowed)."""
    settings: Settings = app.state.settings
    if not settings.mock_mode and not settings.demo_mode:
        await app.state.llm_router.check_models()
    yield


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the app. Tests pass their own Settings; the server loads .env."""
    settings = settings or load_settings()
    settings.data_path.mkdir(parents=True, exist_ok=True)

    app = FastAPI(
        title="CodeXray API",
        version=__version__,
        description="Backend for CodeXray. See docs/API.md for the full contract.",
        responses=ERROR_RESPONSES,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.repair_runs = MockRepairStore()
    app.state.llm_router = LLMRouter(settings)
    app.state.index_service = IndexService(settings, app.state.llm_router)
    app.state.index_service.mark_interrupted()
    app.state.qa_service = QaService(settings, app.state.index_service, app.state.llm_router)
    app.state.repair_service = RepairService(settings, app.state.index_service, app.state.llm_router)
    app.state.repair_service.recover()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_error_handlers(app)

    for module in (health, repos, qa, review, repair, llm):
        app.include_router(module.router)

    def frontend_file(path: str = "") -> FileResponse:
        """Serve built frontend files and route browser navigation through its SPA."""
        index = FRONTEND_DIST / "index.html"
        if not index.is_file():
            raise HTTPException(status_code=503, detail="Frontend build is missing")

        requested = (FRONTEND_DIST / path).resolve()
        if requested != FRONTEND_DIST and FRONTEND_DIST not in requested.parents:
            raise HTTPException(status_code=404, detail="Not found")
        if requested.is_file():
            return FileResponse(requested)
        if path == "" or (path != "api" and not path.startswith("api/")):
            return FileResponse(index)
        raise HTTPException(status_code=404, detail="Not found")

    app.add_api_route("/", frontend_file, methods=["GET"], include_in_schema=False)
    app.add_api_route("/{path:path}", frontend_file, methods=["GET"], include_in_schema=False)
    return app


app = create_app()
