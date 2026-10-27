"""BM25 keyword index over chunks (rank-bm25). Always built; needs no API."""

import pickle
from dataclasses import dataclass
from pathlib import Path

from rank_bm25 import BM25Okapi

from app.indexing.chunker import Chunk
from app.indexing.tokenize import tokenize


@dataclass
class BM25Index:
    chunk_ids: list[str]
    token_sets: list[set[str]]  # for the query-coverage score
    bm25: BM25Okapi | None  # None when the repo has no chunks

    def search(self, query: str, k: int) -> list[tuple[str, float]]:
        """Top k (chunk_id, score) with a positive score."""
        terms = tokenize(query)
        if not self.bm25 or not terms:
            return []
        scores = self.bm25.get_scores(terms)
        ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
        return [(self.chunk_ids[i], float(scores[i])) for i in ranked[:k] if scores[i] > 0]

    def coverage(self, query: str, chunk_id: str) -> float:
        """Share of the query's distinct tokens found in a chunk (0..1)."""
        terms = set(tokenize(query))
        if not terms or chunk_id not in self.chunk_ids:
            return 0.0
        tokens = self.token_sets[self.chunk_ids.index(chunk_id)]
        return len(terms & tokens) / len(terms)


def build_bm25(chunks: list[Chunk]) -> BM25Index:
    corpus = [tokenize(c.text) for c in chunks]
    return BM25Index(
        chunk_ids=[c.id for c in chunks],
        token_sets=[set(tokens) for tokens in corpus],
        bm25=BM25Okapi(corpus) if corpus else None,
    )


def save_bm25(index: BM25Index, path: Path) -> None:
    with path.open("wb") as f:
        pickle.dump(index, f)


def load_bm25(path: Path) -> BM25Index:
    """Load our own bm25.pkl (only ever written by save_bm25)."""
    with path.open("rb") as f:
        return pickle.load(f)
