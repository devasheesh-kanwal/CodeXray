"""Chroma vector store: per repo, one persistent collection per embedding model.

Each collection records which embedding model made its vectors, so Gemini and
NVIDIA vectors of the same repo live side by side and are never mixed:
indexing writes the current model's collection, querying reads only it.
Chroma's built-in (local) embedding function is never used: vectors always
come from app/indexing/embedder.py.
"""

import hashlib
from pathlib import Path

import chromadb
from chromadb.config import Settings as ChromaSettings

from app.indexing.chunker import Chunk

LEGACY_COLLECTION = "chunks"  # before switching existed: one collection for the one model


def collection_name(model: str) -> str:
    """Chroma names allow only [a-zA-Z0-9._-], so use a hash of the model id."""
    return f"chunks-{hashlib.sha256(model.encode('utf-8')).hexdigest()[:16]}"


class EmbeddingModelMismatch(Exception):
    """The index was built with a different embedding model."""


def _client(path: Path) -> chromadb.ClientAPI:
    path.mkdir(parents=True, exist_ok=True)
    return chromadb.PersistentClient(
        path=str(path), settings=ChromaSettings(anonymized_telemetry=False)
    )


class VectorStore:
    def __init__(self, collection) -> None:
        self.collection = collection

    @classmethod
    def for_indexing(cls, path: Path, model: str) -> "VectorStore":
        """Open (or create) this model's collection. Other models' collections are kept."""
        client = _client(path)
        if LEGACY_COLLECTION in {c.name for c in client.list_collections()}:
            legacy = client.get_collection(LEGACY_COLLECTION, embedding_function=None)
            if (legacy.metadata or {}).get("embedding_model") == model:
                client.delete_collection(LEGACY_COLLECTION)  # rebuilt below, from the embedding cache
        return cls(
            client.get_or_create_collection(
                collection_name(model),
                embedding_function=None,
                metadata={"embedding_model": model},
                configuration={"hnsw": {"space": "cosine"}},
            )
        )

    @classmethod
    def for_query(cls, path: Path, model: str) -> "VectorStore":
        """Open this model's collection. Raises EmbeddingModelMismatch if it has none."""
        client = _client(path)
        names = {c.name for c in client.list_collections()}
        for name in (collection_name(model), LEGACY_COLLECTION):
            if name in names:
                collection = client.get_collection(name, embedding_function=None)
                if (collection.metadata or {}).get("embedding_model") == model:
                    return cls(collection)
        raise EmbeddingModelMismatch(
            f"the index has no vectors from '{model}' yet. Re-index the repo."
        )

    def replace_all(self, chunks: list[Chunk], vectors: list[list[float]]) -> None:
        """Make the collection hold exactly these chunks."""
        keep = {c.id for c in chunks}
        stale = [i for i in self.collection.get(include=[])["ids"] if i not in keep]
        if stale:
            self.collection.delete(ids=stale)
        for start in range(0, len(chunks), 500):
            part = chunks[start : start + 500]
            self.collection.upsert(
                ids=[c.id for c in part],
                embeddings=vectors[start : start + 500],
                metadatas=[
                    {"file": c.file, "symbol": c.symbol, "kind": c.kind,
                     "start_line": c.start_line, "end_line": c.end_line, "node_id": c.node_id}
                    for c in part
                ],
            )

    def query(self, vector: list[float], k: int) -> list[tuple[str, float]]:
        """Top k (chunk_id, cosine similarity in [0, 1])."""
        if self.count() == 0:
            return []
        result = self.collection.query(
            query_embeddings=[vector], n_results=min(k, self.count()), include=["distances"]
        )
        return [
            (chunk_id, max(0.0, min(1.0, 1.0 - distance)))
            for chunk_id, distance in zip(result["ids"][0], result["distances"][0])
        ]

    def count(self) -> int:
        return self.collection.count()
