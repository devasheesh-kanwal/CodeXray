"""Chroma vector store, one persistent collection per repo.

The collection records which embedding model made its vectors. Indexing with a
new model rebuilds it; querying with a different model is refused. Chroma's
built-in (local) embedding function is never used: vectors always come from
app/indexing/embedder.py.
"""

from pathlib import Path

import chromadb
from chromadb.config import Settings as ChromaSettings

from app.indexing.chunker import Chunk

COLLECTION = "chunks"


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
        """Open the collection; start over if it was built with another model."""
        client = _client(path)
        existing = {c.name for c in client.list_collections()}
        if COLLECTION in existing:
            collection = client.get_collection(COLLECTION, embedding_function=None)
            if (collection.metadata or {}).get("embedding_model") == model:
                return cls(collection)
            client.delete_collection(COLLECTION)
        return cls(
            client.create_collection(
                COLLECTION,
                embedding_function=None,
                metadata={"embedding_model": model},
                configuration={"hnsw": {"space": "cosine"}},
            )
        )

    @classmethod
    def for_query(cls, path: Path, model: str) -> "VectorStore":
        """Open for searching. Raises EmbeddingModelMismatch if the model differs."""
        collection = _client(path).get_collection(COLLECTION, embedding_function=None)
        stored = (collection.metadata or {}).get("embedding_model")
        if stored != model:
            raise EmbeddingModelMismatch(
                f"index was built with '{stored}', but GEMINI_EMBEDDING_MODEL is '{model}'. "
                "Re-index the repo."
            )
        return cls(collection)

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
