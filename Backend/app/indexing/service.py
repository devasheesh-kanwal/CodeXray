"""IndexService: what the API (and later the agents) use to reach the index."""

import logging
from pathlib import Path

import networkx as nx

from app.api.schemas.repos import RepoGraph, RepoStatus, RepoSummary, RepoTree
from app.config import Settings
from app.errors import ApiError, not_found
from app.indexing.bm25 import load_bm25
from app.indexing.chunker import load_chunks
from app.indexing.graph import load_graph, to_api
from app.indexing.intake import (
    ACTIVE_STAGES,
    IndexingError,
    RepoMeta,
    check_git_url,
    list_metas,
    load_meta,
    normalize_local_path,
    repo_dir,
    repo_id_for,
    repo_name,
    save_meta,
)
from app.indexing.pipeline import IndexReport, Indexer, make_embedder
from app.indexing.search import RepoSearch
from app.indexing.skeleton import Skeleton, load_skeleton, to_tree
from app.indexing.vector_store import EmbeddingModelMismatch, VectorStore
from app.llm import LLMRouter

logger = logging.getLogger("codexray.indexing")


class IndexService:
    def __init__(self, settings: Settings, router: LLMRouter | None = None, embedder=None) -> None:
        self.settings = settings
        self.data_dir = settings.data_path
        self.router = router
        self.embedder = embedder or make_embedder(settings)
        self.running: set[str] = set()

    def mark_interrupted(self) -> None:
        """Repos that were mid-indexing when the server stopped become 'failed'."""
        for meta in list_metas(self.data_dir):
            if meta.stage in ACTIVE_STAGES and meta.repo_id not in self.running:
                meta.stage, meta.error = "failed", "interrupted by a server restart; add it again"
                save_meta(self.data_dir, meta)

    # ---------- intake ----------

    def add_repo(self, git_url: str | None, local_path: str | None) -> RepoMeta:
        """Validate the source and register the repo as 'queued'."""
        try:
            if git_url:
                source = check_git_url(git_url)
                kind, root = "git", None
            else:
                source = str(normalize_local_path(local_path or ""))
                kind, root = "local", source
        except IndexingError as exc:
            raise ApiError(422, "VALIDATION_ERROR", str(exc)) from exc

        repo_id = repo_id_for(source)
        if repo_id in self.running:
            raise ApiError(409, "INVALID_STATE", "This repo is already being indexed",
                           {"repo_id": repo_id})
        meta = load_meta(self.data_dir, repo_id) or RepoMeta(
            repo_id=repo_id, name=repo_name(source), source=source, kind=kind,
            root=root or str(self.data_dir / "repos" / repo_id),
        )
        meta.stage, meta.error = "queued", None
        save_meta(self.data_dir, meta)
        return meta

    async def index(self, repo_id: str) -> IndexReport | None:
        """Run the pipeline (used as a background task). Errors end up in meta.json."""
        meta = self._meta(repo_id)
        self.running.add(repo_id)
        try:
            indexer = Indexer(self.settings, self.router, self.embedder)
            return await indexer.run(meta)
        except Exception:
            return None  # already logged and saved as stage 'failed'
        finally:
            self.running.discard(repo_id)

    # ---------- reads ----------

    def list_repos(self) -> list[RepoSummary]:
        return [
            RepoSummary(repo_id=m.repo_id, name=m.name, status=m.stage, files_total=m.files_total)
            for m in list_metas(self.data_dir)
        ]

    def status(self, repo_id: str) -> RepoStatus:
        meta = self._meta(repo_id)
        return RepoStatus(
            stage=meta.stage, files_done=meta.files_done, files_total=meta.files_total,
            error=meta.error, chunks_total=meta.chunks_total,
            chunks_embedded=meta.chunks_embedded, search_mode=meta.search_mode,
        )

    def tree(self, repo_id: str) -> RepoTree:
        return to_tree(self.skeleton(repo_id))

    def graph(self, repo_id: str) -> RepoGraph:
        return to_api(self.load_graph(repo_id))

    def file_lines(self, repo_id: str, path: str) -> list[str]:
        """Lines of one indexed file. Refuses anything outside the repo."""
        meta = self._meta(repo_id)
        path = path.replace("\\", "/").strip("/")
        if self.skeleton(repo_id).file(path) is None:
            raise not_found("File", path=path)
        root = Path(meta.root).resolve()
        full = (root / path).resolve()
        if not full.is_relative_to(root) or not full.is_file():
            raise not_found("File", path=path)
        return full.read_text(encoding="utf-8", errors="replace").splitlines()

    def skeleton(self, repo_id: str) -> Skeleton:
        return load_skeleton(self._artifact(repo_id, "skeleton.json"))

    def load_graph(self, repo_id: str) -> nx.DiGraph:
        return load_graph(self._artifact(repo_id, "graph.json"))

    def searcher(self, repo_id: str) -> RepoSearch:
        """Hybrid search when the repo has vectors for our model, else BM25 only."""
        meta = self._meta(repo_id)
        folder = repo_dir(self.data_dir, repo_id)
        chunks = load_chunks(self._artifact(repo_id, "chunks.json"))
        bm25 = load_bm25(self._artifact(repo_id, "bm25.pkl"))
        if meta.search_mode != "hybrid" or not self.settings.embeddings:
            return RepoSearch(chunks, bm25)
        try:
            store = VectorStore.for_query(folder / "chroma", self.embedder.model)
        except EmbeddingModelMismatch as exc:
            logger.warning("%s: %s Using BM25 only.", repo_id, exc)
            return RepoSearch(chunks, bm25)
        return RepoSearch(chunks, bm25, store, self.embedder)

    # ---------- helpers ----------

    def _meta(self, repo_id: str) -> RepoMeta:
        meta = load_meta(self.data_dir, repo_id) if _safe_id(repo_id) else None
        if meta is None:
            raise not_found("Repo", repo_id=repo_id)
        return meta

    def _artifact(self, repo_id: str, name: str) -> Path:
        meta = self._meta(repo_id)
        path = repo_dir(self.data_dir, repo_id) / name
        if not path.is_file():
            raise ApiError(409, "INVALID_STATE", f"Repo is not indexed yet (stage: {meta.stage})",
                           {"repo_id": repo_id, "stage": meta.stage})
        return path


def _safe_id(repo_id: str) -> bool:
    """Repo ids are generated by us: letters, digits and dashes only."""
    return bool(repo_id) and all(ch.isalnum() or ch == "-" for ch in repo_id)
