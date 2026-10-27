"""Run every indexing stage for one repo and keep meta.json up to date.

cloning -> parsing -> graph -> bm25 -> embedding -> summaries -> ready
Unchanged files (same sha256) are not parsed again; unchanged chunks are not
embedded again (embedding cache).
"""

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from app.config import Settings
from app.indexing.bm25 import build_bm25, save_bm25
from app.indexing.chunker import Chunk, chunk_file, save_chunks
from app.indexing.embedder import (
    EmbeddingCache,
    EmbeddingError,
    GeminiEmbedder,
    document_text,
)
from app.indexing.files import list_source_files
from app.indexing.graph import build_graph, save_graph
from app.indexing.intake import RepoMeta, clone, repo_dir, save_meta
from app.indexing.parser import parse_python
from app.indexing.skeleton import Skeleton, load_skeleton, save_skeleton
from app.indexing.summaries import summarize_file
from app.indexing.vector_store import VectorStore
from app.llm import LLMRouter

logger = logging.getLogger("codexray.indexing")

PROGRESS_EVERY = 25  # files between meta.json updates while parsing


@dataclass
class IndexReport:
    repo_id: str
    files_total: int = 0
    files_parsed: int = 0
    files_reused: int = 0
    chunks_total: int = 0
    chunks_embedded: int = 0
    search_mode: str = "bm25_only"
    embedding_api_calls: int = 0
    embedding_cache_hits: int = 0
    timings: dict[str, float] = field(default_factory=dict)


def make_embedder(settings: Settings, transport=None, sleep=asyncio.sleep) -> GeminiEmbedder:
    return GeminiEmbedder(
        model=settings.gemini_embedding_model,
        keys=[k.get_secret_value() for k in settings.gemini_api_keys],
        cache=EmbeddingCache(settings.data_path / "embedding_cache.sqlite"),
        demo_mode=settings.demo_mode,
        transport=transport,
        sleep=sleep,
    )


class Indexer:
    def __init__(
        self,
        settings: Settings,
        router: LLMRouter | None = None,
        embedder: GeminiEmbedder | None = None,
        on_update: Callable[[RepoMeta], None] | None = None,
    ) -> None:
        self.settings = settings
        self.data_dir = settings.data_path
        self.router = router
        self.embedder = embedder or make_embedder(settings)
        self.on_update = on_update or (lambda meta: save_meta(self.data_dir, meta))

    async def run(self, meta: RepoMeta) -> IndexReport:
        """Index the repo. On error: stage 'failed' with a message, then re-raise."""
        report = IndexReport(repo_id=meta.repo_id)
        folder = repo_dir(self.data_dir, meta.repo_id)
        try:
            if meta.kind == "git":
                await self._stage(meta, report, "cloning", clone, meta.source, Path(meta.root))
            skeleton, sources = await self._stage(meta, report, "parsing", self._parse, meta, folder, report)
            graph = await self._stage(meta, report, "graph", build_graph, skeleton)
            save_graph(graph, folder / "graph.json")
            chunks = await self._stage(meta, report, "bm25", self._chunks_and_bm25, skeleton, sources, folder)
            meta.chunks_total = report.chunks_total = len(chunks)
            await self._stage(meta, report, "embedding", self._embed, meta, chunks, folder, report)
            if self.settings.file_summaries and self.router:
                await self._stage(meta, report, "summaries", self._summaries, skeleton, sources, report)
            save_skeleton(skeleton, folder / "skeleton.json")
            self._set_stage(meta, "ready")
            return report
        except Exception as exc:
            meta.stage, meta.error = "failed", str(exc)[:300] or type(exc).__name__
            self.on_update(meta)
            logger.exception("Indexing %s failed", meta.repo_id)
            raise

    async def _stage(self, meta, report, name, func, *args):
        """Run one stage (sync stages in a worker thread) and record its time."""
        self._set_stage(meta, name)
        started = time.perf_counter()
        if asyncio.iscoroutinefunction(func):
            result = await func(*args)
        else:
            result = await asyncio.to_thread(func, *args)
        report.timings[name] = round(time.perf_counter() - started, 3)
        return result

    def _set_stage(self, meta: RepoMeta, stage: str) -> None:
        meta.stage = stage
        meta.error = None
        self.on_update(meta)

    # ---------- stages ----------

    def _parse(self, meta: RepoMeta, folder: Path, report: IndexReport):
        """Skeleton for every file; files whose hash is unchanged are reused."""
        files = list_source_files(Path(meta.root))
        previous = self._previous_skeleton(folder)
        meta.files_total, meta.files_done = len(files), 0
        report.files_total = len(files)
        self.on_update(meta)

        parsed, sources = [], {}
        for i, repo_file in enumerate(files, start=1):
            source = repo_file.abs_path.read_bytes()
            sources[repo_file.path] = source.decode("utf-8", errors="replace").splitlines()
            old = previous.get(repo_file.path)
            if old and old.sha256 == repo_file.sha256:
                parsed.append(old)
                report.files_reused += 1
            else:
                parsed.append(parse_python(repo_file.path, source, repo_file.sha256))
                report.files_parsed += 1
            if i % PROGRESS_EVERY == 0 or i == len(files):
                meta.files_done = i
                self.on_update(meta)
        skeleton = Skeleton(repo_id=meta.repo_id, name=meta.name, files=parsed)
        save_skeleton(skeleton, folder / "skeleton.json")
        return skeleton, sources

    @staticmethod
    def _previous_skeleton(folder: Path) -> dict:
        path = folder / "skeleton.json"
        if not path.is_file():
            return {}
        try:
            return {f.path: f for f in load_skeleton(path).files}
        except ValueError:
            return {}  # unreadable old skeleton: parse everything again

    @staticmethod
    def _chunks_and_bm25(skeleton: Skeleton, sources: dict, folder: Path) -> list[Chunk]:
        chunks = [c for f in skeleton.files for c in chunk_file(f, sources[f.path])]
        save_chunks(chunks, folder / "chunks.json")
        save_bm25(build_bm25(chunks), folder / "bm25.pkl")
        return chunks

    async def _embed(self, meta: RepoMeta, chunks: list[Chunk], folder: Path, report) -> None:
        meta.embedding_model = None
        if not self.settings.embeddings:
            return self._bm25_only(meta, report, 0, "EMBEDDINGS=false")
        if not self.embedder.available:
            return self._bm25_only(meta, report, 0, "no GEMINI_API_KEYS")
        calls_before = self.embedder.api_calls
        hits_before = self.embedder.cache_hits
        try:
            vectors = await self.embedder.embed_documents([(c.id, c.text) for c in chunks])
        except EmbeddingError as exc:
            embedded = self._cached_count(chunks)
            return self._bm25_only(meta, report, embedded, str(exc))
        finally:
            report.embedding_api_calls = self.embedder.api_calls - calls_before
            report.embedding_cache_hits = self.embedder.cache_hits - hits_before

        if any(v is None for v in vectors):  # DEMO_MODE cache misses
            embedded = sum(v is not None for v in vectors)
            return self._bm25_only(meta, report, embedded, "DEMO_MODE and some chunks not cached")
        store = VectorStore.for_indexing(folder / "chroma", self.embedder.model)
        await asyncio.to_thread(store.replace_all, chunks, vectors)
        meta.search_mode, report.search_mode = "hybrid", "hybrid"
        meta.chunks_embedded = report.chunks_embedded = len(chunks)
        meta.embedding_model = self.embedder.model
        self.on_update(meta)

    def _bm25_only(self, meta: RepoMeta, report: IndexReport, embedded: int, reason: str) -> None:
        logger.warning("%s: BM25-only search (%s)", meta.repo_id, reason)
        meta.search_mode, report.search_mode = "bm25_only", "bm25_only"
        meta.chunks_embedded = report.chunks_embedded = embedded
        self.on_update(meta)

    def _cached_count(self, chunks: list[Chunk]) -> int:
        """How many chunks already have a vector in the cache."""
        keys = [self.embedder.cache.key(self.embedder.model, document_text(c.id, c.text))
                for c in chunks]
        return len(self.embedder.cache.get_many(keys))

    async def _summaries(self, skeleton: Skeleton, sources: dict, report: IndexReport) -> None:
        """Summaries for files that don't have one yet (new or changed files)."""
        for file in skeleton.files:
            if file.summary is None and sources[file.path]:
                file.summary = await summarize_file(self.router, file, sources[file.path])
