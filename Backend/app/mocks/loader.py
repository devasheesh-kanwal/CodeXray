"""Load JSON fixtures from app/mocks/fixtures/ and validate them on load."""

from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter

from app.api.schemas.embeddings import EmbeddingsResponse
from app.api.schemas.llm import LlmStatus, ModelsResponse
from app.api.schemas.qa import AskResponse
from app.api.schemas.repos import (
    RepoGraph,
    RepoStatus,
    RepoSummary,
    RepoTree,
    RulesResponse,
)
from app.api.schemas.review import ReviewResponse
from app.mocks.models import MockFiles, RepairScript

FIXTURES_DIR = Path(__file__).parent / "fixtures"

# Fixture file name (without .json) -> the model it must match.
FIXTURE_MODELS: dict[str, Any] = {
    "repos": list[RepoSummary],
    "repo_status": RepoStatus,
    "tree": RepoTree,
    "graph": RepoGraph,
    "files": MockFiles,
    "ask": AskResponse,
    "review": ReviewResponse,
    "rules": RulesResponse,
    "repair_script": RepairScript,
    "llm_status": LlmStatus,
    "llm_models": ModelsResponse,
    "embeddings": EmbeddingsResponse,
}


@lru_cache
def get_fixture(name: str) -> Any:
    """Return fixture `name` parsed into its model. Raises if it doesn't match."""
    raw = (FIXTURES_DIR / f"{name}.json").read_bytes()
    return TypeAdapter(FIXTURE_MODELS[name]).validate_json(raw)
