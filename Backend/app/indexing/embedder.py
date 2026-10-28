"""Embeddings (Gemini or NVIDIA): the ONLY code in CodeXray that calls an embedding API.

Each provider has one fixed model (GEMINI_EMBEDDING_MODEL, NVIDIA_EMBEDDING_MODEL).
Which provider is used is picked by hand (EMBEDDING_PROVIDER, or the app's model
menu); there is never an automatic fallback to the other one. On errors an
embedder retries with backoff, then raises EmbeddingError and the caller
continues with BM25 only. Indexing retries patiently (minutes); a question
gives up within seconds, because its caller can answer with BM25 right away.
Every vector is cached on disk by sha256(model + text), so unchanged chunks
are never embedded twice.
"""

import array
import asyncio
import hashlib
import logging
import sqlite3
import time
from collections.abc import Awaitable, Callable
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import httpx2

from app.config import mask_key

logger = logging.getLogger("codexray.embeddings")

API_BASE = "https://generativelanguage.googleapis.com/v1beta"
NVIDIA_URL = "https://integrate.api.nvidia.com/v1/embeddings"
DIMENSIONS = 768  # Gemini: Google's recommended size; gemini-embedding-2 normalizes it
NVIDIA_DIMENSIONS = 1024  # nemotron embed models can shorten their 2048-d vectors
BATCH_SIZE = 100  # texts per request
MAX_TRIES = 5
MAX_TEXT_CHARS = 24_000  # ~6k tokens, under the models' 8,192-token input limit
TIMEOUT_S = 60.0
MAX_WAIT_S = 90.0  # longest single wait between retries

# A question is waiting: try twice, wait at most 2 s, and if the API asks for longer, use BM25.
QUERY_MAX_TRIES = 2
QUERY_MAX_WAIT_S = 2.0
QUERY_TIMEOUT_S = 8.0
QUERY_PAUSE_S = 30.0  # rate limited without a stated wait: skip query embeddings this long

Vector = list[float]
Kind = Literal["document", "query"]


@dataclass(frozen=True)
class RetryPolicy:
    tries: int
    max_wait: float  # longest single wait; a question gives up instead of waiting longer
    timeout: float
    give_up_on_long_wait: bool


DOCUMENTS = RetryPolicy(MAX_TRIES, MAX_WAIT_S, TIMEOUT_S, give_up_on_long_wait=False)
QUERY = RetryPolicy(QUERY_MAX_TRIES, QUERY_MAX_WAIT_S, QUERY_TIMEOUT_S, give_up_on_long_wait=True)


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


class Embedder:
    """Cache, retries and the query pause, shared by both providers.

    Subclasses say how texts are written, how a request is sent and how the
    answer is read. `transport`, `sleep` and `clock` are injectable so tests
    never touch the network.
    """

    provider = ""  # "gemini" or "nvidia"
    label = ""  # name shown in logs and in the app

    def __init__(
        self,
        model: str,
        keys: list[str],
        cache: EmbeddingCache,
        demo_mode: bool = False,
        transport: httpx2.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.model = model
        self.keys = list(keys)
        self.cache = cache
        self.demo_mode = demo_mode  # cache only, never call the API
        self.transport = transport
        self.sleep = sleep
        self.clock = clock
        # While the API is rate limiting, questions skip it (and use BM25) until this time.
        self.queries_paused_until = 0.0
        self.api_calls = 0  # HTTP requests made (for index_repo.py)
        self.cache_hits = 0

    @property
    def available(self) -> bool:
        return bool(self.keys) or self.demo_mode

    async def embed_documents(self, items: list[tuple[str, str]]) -> list[Vector | None]:
        """Vectors for (title, text) pairs. None only for DEMO_MODE cache misses."""
        texts = [self.document_text(title, text) for title, text in items]
        return await self._embed(texts, "document", DOCUMENTS)

    async def embed_query(self, query: str) -> Vector | None:
        """The question's vector, within seconds or not at all (EmbeddingError: use BM25)."""
        return (await self._embed([self.query_text(query)], "query", QUERY))[0]

    def cached_count(self, items: list[tuple[str, str]]) -> int:
        """How many of these (title, text) documents already have a cached vector."""
        keys = [self.cache_key(self.document_text(title, text), "document") for title, text in items]
        return len(self.cache.get_many(keys))

    # ---------- provider specific ----------

    def document_text(self, title: str, text: str) -> str:
        raise NotImplementedError

    def query_text(self, query: str) -> str:
        raise NotImplementedError

    def cache_key(self, text: str, kind: Kind) -> str:
        return EmbeddingCache.key(self.model, text)

    async def _post(self, client: httpx2.AsyncClient, key: str, texts: list[str], kind: Kind) -> httpx2.Response:
        raise NotImplementedError

    def _parse(self, data: dict, expected: int) -> list[Vector]:
        raise NotImplementedError

    # ---------- shared ----------

    async def _embed(self, texts: list[str], kind: Kind, policy: RetryPolicy) -> list[Vector | None]:
        keys = [self.cache_key(t, kind) for t in texts]
        found = self.cache.get_many(keys)
        self.cache_hits += sum(1 for k in keys if k in found)
        missing = [i for i, k in enumerate(keys) if k not in found]
        if missing and not self.demo_mode:
            if policy is QUERY and self.clock() < self.queries_paused_until:
                wait = self.queries_paused_until - self.clock()
                raise EmbeddingError(f"rate limited, query embeddings paused for {wait:.0f}s more")
            async with self._client(policy.timeout) as client:
                for start in range(0, len(missing), BATCH_SIZE):
                    batch = missing[start : start + BATCH_SIZE]
                    vectors = await self._request_batch(client, [texts[i] for i in batch], kind, policy)
                    new = {keys[i]: v for i, v in zip(batch, vectors)}
                    self.cache.put_many(new)  # saved per batch: a later failure keeps these
                    found.update(new)
        return [found.get(k) for k in keys]

    def _client(self, timeout: float) -> httpx2.AsyncClient:
        if self.transport:
            return httpx2.AsyncClient(transport=self.transport, timeout=timeout)
        return httpx2.AsyncClient(timeout=timeout)

    async def _request_batch(
        self, client: httpx2.AsyncClient, texts: list[str], kind: Kind, policy: RetryPolicy
    ) -> list[Vector]:
        problem = "no API keys"
        for attempt in range(1, policy.tries + 1):
            if not self.keys:
                break
            key = self.keys[0]
            try:
                self.api_calls += 1
                response = await self._post(client, key, texts, kind)
            except httpx2.TransportError as exc:
                problem = f"network error: {type(exc).__name__}"
                await self._backoff(attempt, None, policy)
                continue

            if response.status_code == 200:
                return self._parse(response.json(), len(texts))
            if response.status_code in (401, 403):
                logger.warning("%s embedding key %s rejected (%s); not using it again",
                               self.label, mask_key(key), response.status_code)
                self.keys.remove(key)
                problem = f"key rejected ({response.status_code})"
                continue
            if response.status_code == 429 or response.status_code >= 500:
                problem = f"HTTP {response.status_code}"
                wait = server_delay(response)
                if policy.give_up_on_long_wait and response.status_code == 429:
                    if wait is None or wait > policy.max_wait:
                        # The API wants a long pause: answer this and the next questions with BM25.
                        self.queries_paused_until = self.clock() + min(wait or QUERY_PAUSE_S, MAX_WAIT_S)
                        raise EmbeddingError(f"rate limited (HTTP 429); retry in {wait or QUERY_PAUSE_S:.0f}s")
                await self._backoff(attempt, wait, policy)
                continue
            raise EmbeddingError(f"HTTP {response.status_code}: {response.text[:200]}")
        raise EmbeddingError(f"{self.model} embeddings failed after retries ({problem})")

    async def _backoff(self, attempt: int, server_wait: float | None, policy: RetryPolicy) -> None:
        """Exponential backoff (2, 4, 8, 16 s), or longer if the server asks for it, up to policy.max_wait."""
        if attempt >= policy.tries:
            return
        wait = min(max(2.0**attempt, server_wait or 0.0), policy.max_wait)
        logger.warning("Embedding request failed; retry %d/%d in %.0fs", attempt, policy.tries - 1, wait)
        await self.sleep(wait)


class GeminiEmbedder(Embedder):
    """Google's batchEmbedContents API."""

    provider = "gemini"
    label = "Gemini"

    def document_text(self, title: str, text: str) -> str:
        return document_text(title, text)

    def query_text(self, query: str) -> str:
        return query_text(query)

    async def _post(self, client, key, texts, kind):
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
        url = f"{API_BASE}/models/{self.model}:batchEmbedContents"
        return await client.post(url, json=body, headers={"x-goog-api-key": key})

    def _parse(self, data: dict, expected: int) -> list[Vector]:
        embeddings = data.get("embeddings") or []
        vectors = [e.get("values") or [] for e in embeddings]
        if len(vectors) != expected or any(len(v) != DIMENSIONS for v in vectors):
            raise EmbeddingError(
                f"unexpected response: {len(vectors)} vectors for {expected} texts"
            )
        return vectors


class NvidiaEmbedder(Embedder):
    """NVIDIA's OpenAI-style /v1/embeddings API (integrate.api.nvidia.com)."""

    provider = "nvidia"
    label = "NVIDIA"

    def document_text(self, title: str, text: str) -> str:
        return f"{title}\n{text}"[:MAX_TEXT_CHARS]

    def query_text(self, query: str) -> str:
        return query[:MAX_TEXT_CHARS]

    def cache_key(self, text: str, kind: Kind) -> str:
        # The text is the same for both kinds; the API embeds queries and passages differently.
        return EmbeddingCache.key(f"{self.model}#{kind}", text)

    async def _post(self, client, key, texts, kind):
        body = {
            "model": self.model,
            "input": texts,
            "input_type": "query" if kind == "query" else "passage",
            "encoding_format": "float",
            "truncate": "END",
            "dimensions": NVIDIA_DIMENSIONS,
        }
        return await client.post(NVIDIA_URL, json=body, headers={"Authorization": f"Bearer {key}"})

    def _parse(self, data: dict, expected: int) -> list[Vector]:
        items = sorted(data.get("data") or [], key=lambda item: item.get("index", 0))
        vectors = [item.get("embedding") or [] for item in items]
        if len(vectors) != expected or any(len(v) != NVIDIA_DIMENSIONS for v in vectors):
            raise EmbeddingError(
                f"unexpected response: {len(vectors)} vectors for {expected} texts"
            )
        return vectors
