"""Gemini embeddings: the ONLY code in CodeXray that calls an embedding API.

One fixed model (GEMINI_EMBEDDING_MODEL). Never falls back to another model:
on errors it retries with backoff, then raises EmbeddingError and the caller
continues with BM25 only. Every vector is cached on disk by
sha256(model + text), so unchanged chunks are never embedded twice.
"""

import array
import asyncio
import hashlib
import logging
import sqlite3
from collections.abc import Awaitable, Callable
from contextlib import closing
from pathlib import Path

import httpx2

from app.config import mask_key

logger = logging.getLogger("codexray.embeddings")

API_BASE = "https://generativelanguage.googleapis.com/v1beta"
DIMENSIONS = 768  # Google's recommended size; gemini-embedding-2 normalizes it
BATCH_SIZE = 100  # texts per batchEmbedContents request
MAX_TRIES = 5
MAX_TEXT_CHARS = 24_000  # ~6k tokens, under the model's 8,192-token input limit
TIMEOUT_S = 60.0
MAX_WAIT_S = 90.0  # longest single wait between retries

Vector = list[float]


class EmbeddingError(Exception):
    """Embeddings are unavailable for now (after retries)."""


def server_delay(response: httpx2.Response) -> float | None:
    """Seconds the server asks us to wait: Retry-After header, or Gemini's
    RetryInfo.retryDelay (e.g. "14s") in the error body. The free tier allows
    100 embedded texts per minute, so this is usually the time to the next minute.
    """
    try:
        if response.headers.get("retry-after"):
            return float(response.headers["retry-after"])
        for detail in response.json().get("error", {}).get("details", []):
            if detail.get("@type", "").endswith("RetryInfo"):
                return float(str(detail.get("retryDelay", "")).rstrip("s"))
    except (ValueError, AttributeError):
        pass
    return None


def document_text(title: str, text: str) -> str:
    """Google's recommended input format for documents (gemini-embedding-2)."""
    return f"title: {title} | text: {text}"[:MAX_TEXT_CHARS]


def query_text(query: str) -> str:
    """Google's recommended input format for search queries (gemini-embedding-2)."""
    return f"task: search result | query: {query}"[:MAX_TEXT_CHARS]


class EmbeddingCache:
    """SQLite cache: sha256(model + text) -> float32 vector."""

    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(path)) as db, db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS vectors (key TEXT PRIMARY KEY, vector BLOB NOT NULL)"
            )

    @staticmethod
    def key(model: str, text: str) -> str:
        return hashlib.sha256(f"{model}\n{text}".encode("utf-8")).hexdigest()

    def get_many(self, keys: list[str]) -> dict[str, Vector]:
        found: dict[str, Vector] = {}
        with closing(sqlite3.connect(self.path)) as db:
            for start in range(0, len(keys), 500):
                part = keys[start : start + 500]
                rows = db.execute(
                    f"SELECT key, vector FROM vectors WHERE key IN ({','.join('?' * len(part))})",
                    part,
                ).fetchall()
                found.update({k: array.array("f", blob).tolist() for k, blob in rows})
        return found

    def put_many(self, items: dict[str, Vector]) -> None:
        with closing(sqlite3.connect(self.path)) as db, db:
            db.executemany(
                "INSERT OR REPLACE INTO vectors (key, vector) VALUES (?, ?)",
                [(k, array.array("f", v).tobytes()) for k, v in items.items()],
            )


class GeminiEmbedder:
    """`transport` and `sleep` are injectable so tests never touch the network."""

    def __init__(
        self,
        model: str,
        keys: list[str],
        cache: EmbeddingCache,
        demo_mode: bool = False,
        transport: httpx2.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.model = model
        self.keys = list(keys)
        self.cache = cache
        self.demo_mode = demo_mode  # cache only, never call the API
        self.transport = transport
        self.sleep = sleep
        self.api_calls = 0  # HTTP requests made (for index_repo.py)
        self.cache_hits = 0

    @property
    def available(self) -> bool:
        return bool(self.keys) or self.demo_mode

    async def embed_documents(self, items: list[tuple[str, str]]) -> list[Vector | None]:
        """Vectors for (title, text) pairs. None only for DEMO_MODE cache misses."""
        return await self._embed([document_text(title, text) for title, text in items])

    async def embed_query(self, query: str) -> Vector | None:
        return (await self._embed([query_text(query)]))[0]

    async def _embed(self, texts: list[str]) -> list[Vector | None]:
        keys = [EmbeddingCache.key(self.model, t) for t in texts]
        found = self.cache.get_many(keys)
        self.cache_hits += sum(1 for k in keys if k in found)
        missing = [i for i, k in enumerate(keys) if k not in found]
        if missing and not self.demo_mode:
            async with self._client() as client:
                for start in range(0, len(missing), BATCH_SIZE):
                    batch = missing[start : start + BATCH_SIZE]
                    vectors = await self._request_batch(client, [texts[i] for i in batch])
                    new = {keys[i]: v for i, v in zip(batch, vectors)}
                    self.cache.put_many(new)  # saved per batch: a later failure keeps these
                    found.update(new)
        return [found.get(k) for k in keys]

    def _client(self) -> httpx2.AsyncClient:
        if self.transport:
            return httpx2.AsyncClient(transport=self.transport, timeout=TIMEOUT_S)
        return httpx2.AsyncClient(timeout=TIMEOUT_S)

    async def _request_batch(self, client: httpx2.AsyncClient, texts: list[str]) -> list[Vector]:
        url = f"{API_BASE}/models/{self.model}:batchEmbedContents"
        body = {
            "requests": [
                {
                    "model": f"models/{self.model}",
                    "content": {"parts": [{"text": t}]},
                    "outputDimensionality": DIMENSIONS,
                }
                for t in texts
            ]
        }
        problem = "no API keys"
        for attempt in range(1, MAX_TRIES + 1):
            if not self.keys:
                break
            key = self.keys[0]
            try:
                self.api_calls += 1
                response = await client.post(url, json=body, headers={"x-goog-api-key": key})
            except httpx2.TransportError as exc:
                problem = f"network error: {type(exc).__name__}"
                await self._backoff(attempt, None)
                continue

            if response.status_code == 200:
                return self._parse(response.json(), len(texts))
            if response.status_code in (401, 403):
                logger.warning("Gemini embedding key %s rejected (%s); not using it again",
                               mask_key(key), response.status_code)
                self.keys.remove(key)
                problem = f"key rejected ({response.status_code})"
                continue
            if response.status_code == 429 or response.status_code >= 500:
                problem = f"HTTP {response.status_code}"
                await self._backoff(attempt, server_delay(response))
                continue
            raise EmbeddingError(f"HTTP {response.status_code}: {response.text[:200]}")
        raise EmbeddingError(f"{self.model} embeddings failed after retries ({problem})")

    async def _backoff(self, attempt: int, server_wait: float | None) -> None:
        """Exponential backoff (2, 4, 8, 16 s), or longer if the server asks for it."""
        if attempt >= MAX_TRIES:
            return
        wait = min(max(2.0**attempt, server_wait or 0.0), MAX_WAIT_S)
        logger.warning("Embedding request failed; retry %d/%d in %.0fs", attempt, MAX_TRIES - 1, wait)
        await self.sleep(wait)

    @staticmethod
    def _parse(data: dict, expected: int) -> list[Vector]:
        embeddings = data.get("embeddings") or []
        vectors = [e.get("values") or [] for e in embeddings]
        if len(vectors) != expected or any(len(v) != DIMENSIONS for v in vectors):
            raise EmbeddingError(
                f"unexpected response: {len(vectors)} vectors for {expected} texts"
            )
        return vectors
