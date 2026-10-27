"""Fixtures for indexing tests: a fresh copy of tests/fixtures/sample_repo."""

import shutil
from dataclasses import dataclass
from pathlib import Path

import networkx as nx
import pytest

from app.indexing.bm25 import BM25Index, build_bm25
from app.indexing.chunker import Chunk, chunk_file
from app.indexing.files import list_source_files
from app.indexing.graph import build_graph
from app.indexing.parser import parse_python
from app.indexing.skeleton import Skeleton

SAMPLE_REPO = Path(__file__).resolve().parent.parent / "fixtures" / "sample_repo"


@pytest.fixture
def repo(tmp_path) -> Path:
    """A writable copy of the sample repo (tests may add or change files)."""
    dest = tmp_path / "sample_repo"
    shutil.copytree(SAMPLE_REPO, dest)
    return dest


@dataclass
class Parts:
    chunks: list[Chunk]
    bm25: BM25Index
    graph: nx.DiGraph


def build_parts(root: Path) -> Parts:
    """Skeleton -> graph, chunks, BM25 for a folder (no pipeline, no embeddings)."""
    files, chunks = [], []
    for f in list_source_files(root):
        source = f.abs_path.read_bytes()
        skeleton = parse_python(f.path, source, f.sha256)
        files.append(skeleton)
        chunks += chunk_file(skeleton, source.decode().splitlines())
    graph = build_graph(Skeleton(repo_id="r", name="r", files=files))
    return Parts(chunks, build_bm25(chunks), graph)
