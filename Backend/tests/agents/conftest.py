"""Shared fixtures for agent tests: an indexed sample repo (BM25 only, no network)."""

import asyncio
import shutil
from dataclasses import dataclass
from pathlib import Path

import pytest

from app.agents.state import RunState
from app.agents.tools import ToolContext
from app.indexing.pipeline import Indexer
from app.indexing.service import IndexService
from tests.conftest import make_settings

SAMPLE_REPO = Path(__file__).resolve().parent.parent / "fixtures" / "sample_repo"


@dataclass
class Indexed:
    service: IndexService
    repo_id: str
    root: Path
    data_dir: Path


@pytest.fixture
def indexed(tmp_path) -> Indexed:
    """The sample repo indexed with EMBEDDINGS=false (search is bm25_only)."""
    root = tmp_path / "sample_repo"
    shutil.copytree(SAMPLE_REPO, root)
    settings = make_settings(tmp_path, mock_mode=False, embeddings=False, data_dir=tmp_path / "data")
    service = IndexService(settings)
    meta = service.add_repo(None, str(root))
    asyncio.run(Indexer(settings, None, service.embedder).run(meta))
    return Indexed(service, meta.repo_id, root, settings.data_path)


@pytest.fixture
def ctx(indexed) -> ToolContext:
    state = RunState.new("qa", indexed.repo_id).attach(indexed.data_dir / "runs")
    return ToolContext(index=indexed.service, repo_id=indexed.repo_id, state=state)
