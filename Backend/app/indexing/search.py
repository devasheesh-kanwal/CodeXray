"""Hybrid search: BM25 (always) + vectors (when available), merged with RRF."""

import logging
from typing import Literal

from pydantic import BaseModel

from app.indexing.bm25 import BM25Index
from app.indexing.chunker import Chunk
from app.indexing.embedder import Embedder, EmbeddingError
from app.indexing.vector_store import VectorStore

logger = logging.getLogger("codexray.search")

CANDIDATES = 50  # results taken from each method before fusing
RRF_K = 60  # standard reciprocal-rank-fusion constant


class SearchHit(BaseModel):
    chunk_id: str
    file: str
    symbol: str
    start_line: int
    end_line: int
    score: float  # RRF score (higher = better); only for ordering
    method: Literal["bm25", "vector", "both"]


class SearchResult(BaseModel):
    hits: list[SearchHit]
    best_score: float  # 0..1, how well the best result matches (for "not found")
    mode: Literal["hybrid", "bm25_only"]
    embedding_provider: str | None = None  # whose vectors scored best_score in hybrid mode


def reciprocal_rank_fusion(rankings: list[list[str]], k: int = RRF_K) -> dict[str, float]:
    """score(doc) = sum over rankings of 1 / (k + rank)."""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, doc_id in enumerate(ranking, start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    return scores


class RepoSearch:
    """Search over one indexed repo. `vectors`/`embedder` are None in BM25-only mode."""

    def __init__(
        self,
        chunks: list[Chunk],
        bm25: BM25Index,
        vectors: VectorStore | None = None,
        embedder: Embedder | None = None,
    ) -> None:
        self.chunks = {c.id: c for c in chunks}
        self.bm25 = bm25
        self.vectors = vectors
        self.embedder = embedder

    async def search(self, query: str, k: int = 12) -> SearchResult:
        bm25_hits = self.bm25.search(query, CANDIDATES)
        vector_hits = await self._vector_search(query)

        bm25_ids = [chunk_id for chunk_id, _ in bm25_hits]
        vector_ids = [chunk_id for chunk_id, _ in vector_hits]
        fused = reciprocal_rank_fusion([bm25_ids, vector_ids])
        ranked = sorted(fused, key=lambda chunk_id: fused[chunk_id], reverse=True)[:k]

        hits = [
            self._hit(chunk_id, fused[chunk_id], chunk_id in bm25_ids, chunk_id in vector_ids)
            for chunk_id in ranked
            if chunk_id in self.chunks
        ]
        best_score = max(
            vector_hits[0][1] if vector_hits else 0.0,
            self.bm25.coverage(query, bm25_ids[0]) if bm25_ids else 0.0,
        )
        mode = "hybrid" if self.vectors is not None else "bm25_only"
        provider = self.embedder.provider if mode == "hybrid" and self.embedder else None
        return SearchResult(hits=hits, best_score=round(best_score, 4), mode=mode,
                            embedding_provider=provider)

    async def _vector_search(self, query: str) -> list[tuple[str, float]]:
        if self.vectors is None or self.embedder is None:
            return []
        try:
            vector = await self.embedder.embed_query(query)
        except EmbeddingError as exc:
            logger.warning("Query embedding failed (%s); using BM25 only for this query", exc)
            return []
        return self.vectors.query(vector, CANDIDATES) if vector else []

    def _hit(self, chunk_id: str, score: float, in_bm25: bool, in_vector: bool) -> SearchHit:
        chunk = self.chunks[chunk_id]
        method = "both" if in_bm25 and in_vector else ("bm25" if in_bm25 else "vector")
        return SearchHit(
            chunk_id=chunk_id, file=chunk.file, symbol=chunk.symbol,
            start_line=chunk.start_line, end_line=chunk.end_line,
            score=round(score, 6), method=method,
        )
