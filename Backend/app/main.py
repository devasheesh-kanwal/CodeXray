"""FastAPI app factory. Run with: uvicorn app.main:app --reload"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
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
    return app


app = create_app()
