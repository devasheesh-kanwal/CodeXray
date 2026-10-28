"""Gemini embedder (mocked API) and the Chroma vector store."""

import asyncio
import json

import pytest

from app.indexing.chunker import Chunk
from app.indexing.embedder import (
    BATCH_SIZE,
    DIMENSIONS,
    EmbeddingCache,
    EmbeddingError,
    GeminiEmbedder,
)
from app.indexing.vector_store import EmbeddingModelMismatch, VectorStore
from tests.indexing.fakes import FakeGemini, fake_vector

MODEL = "gemini-embedding-2"


def make(tmp_path, fake, keys=("AIzaFIRST1111",), demo=False):
    sleeps: list[float] = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)

    embedder = GeminiEmbedder(
        MODEL, list(keys), EmbeddingCache(tmp_path / "embedding_cache.sqlite"),
        demo_mode=demo, transport=fake.transport(), sleep=fake_sleep,
    )
    return embedder, sleeps


def docs(n):
    return [(f"file.py::f{i}", f"def function_{i}(): return {i}") for i in range(n)]


def test_batches_and_request_format(tmp_path):
    fake = FakeGemini()
    embedder, _ = make(tmp_path, fake)
    vectors = asyncio.run(embedder.embed_documents(docs(BATCH_SIZE * 2 + 5)))

    assert len(vectors) == 205 and all(len(v) == DIMENSIONS for v in vectors)
    assert embedder.api_calls == 3
    request = fake.requests[0]
    assert str(request.url).endswith(f"/models/{MODEL}:batchEmbedContents")
    assert "key" not in str(request.url).lower()  # key only in the header
    assert request.headers["x-goog-api-key"] == "AIzaFIRST1111"
    body = json.loads(request.content)["requests"][0]
    assert body["model"] == f"models/{MODEL}"
    assert body["outputDimensionality"] == DIMENSIONS
    assert body["content"]["parts"][0]["text"].startswith("title: file.py::f0 | text: def")


def test_cache_hit_makes_no_call(tmp_path):
    fake = FakeGemini()
    first, _ = make(tmp_path, fake)
    asyncio.run(first.embed_documents(docs(10)))
    second, _ = make(tmp_path, fake)  # same cache file
    asyncio.run(second.embed_documents(docs(10) + [("new.py::g", "def g(): pass")]))
    assert second.api_calls == 1
    assert second.cache_hits == 10
    assert fake.texts_sent()[-1].startswith("title: new.py::g")


def test_query_and_document_texts_are_cached_separately(tmp_path):
    embedder, _ = make(tmp_path, FakeGemini())
    asyncio.run(embedder.embed_documents([("t", "user")]))
    asyncio.run(embedder.embed_query("user"))
    assert embedder.api_calls == 2


def test_429_backs_off_and_retries_same_model(tmp_path):
    fake = FakeGemini(failures=[429, 503])
    embedder, sleeps = make(tmp_path, fake)
    vectors = asyncio.run(embedder.embed_documents(docs(3)))
    assert len(vectors) == 3
    assert sleeps == [2.0, 4.0]
    assert {str(r.url) for r in fake.requests} == {str(fake.requests[0].url)}  # one model only


def test_retry_after_header_is_respected(tmp_path):
    embedder, sleeps = make(tmp_path, FakeGemini(failures=[429], retry_after="30"))
    asyncio.run(embedder.embed_documents(docs(1)))
    assert sleeps == [30.0]


def test_gemini_retry_delay_in_body_is_respected(tmp_path):
    embedder, sleeps = make(tmp_path, FakeGemini(failures=[429], retry_delay="37s"))
    asyncio.run(embedder.embed_documents(docs(1)))
    assert sleeps == [37.0]


def test_server_wait_is_capped(tmp_path):
    embedder, sleeps = make(tmp_path, FakeGemini(failures=[429], retry_delay="3600s"))
    asyncio.run(embedder.embed_documents(docs(1)))
    assert sleeps == [90.0]


def test_gives_up_after_five_tries(tmp_path):
    fake = FakeGemini(failures=[429] * 10)
    embedder, sleeps = make(tmp_path, fake)
    with pytest.raises(EmbeddingError, match="after retries"):
        asyncio.run(embedder.embed_documents(docs(1)))
    assert len(fake.requests) == 5
    assert sleeps == [2.0, 4.0, 8.0, 16.0]


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def make_query_embedder(tmp_path, fake):
    """An embedder whose clock the test moves, to check the query pause."""
    embedder, sleeps = make(tmp_path, fake)
    embedder.clock = Clock()
    return embedder, sleeps


def test_question_gives_up_at_once_when_gemini_asks_for_a_long_wait(tmp_path):
    # Indexing would wait the 37 s; a question uses BM25 right away instead.
    fake = FakeGemini(failures=[429], retry_delay="37s")
    embedder, sleeps = make_query_embedder(tmp_path, fake)
    with pytest.raises(EmbeddingError, match="retry in 37s"):
        asyncio.run(embedder.embed_query("how does login work"))
    assert sleeps == [] and len(fake.requests) == 1


def test_questions_skip_the_api_while_rate_limited_then_try_again(tmp_path):
    fake = FakeGemini(failures=[429], retry_delay="37s")
    embedder, _ = make_query_embedder(tmp_path, fake)
    with pytest.raises(EmbeddingError):
        asyncio.run(embedder.embed_query("first question"))
    with pytest.raises(EmbeddingError, match="paused"):
        asyncio.run(embedder.embed_query("second question"))
    assert len(fake.requests) == 1  # the second question made no request

    embedder.clock.now += 38
    assert asyncio.run(embedder.embed_query("third question"))
    assert len(fake.requests) == 2


def test_a_cached_question_is_answered_even_while_paused(tmp_path):
    fake = FakeGemini()
    embedder, _ = make_query_embedder(tmp_path, fake)
    asyncio.run(embedder.embed_query("same question"))
    embedder.queries_paused_until = embedder.clock.now + 60
    assert asyncio.run(embedder.embed_query("same question"))
    assert len(fake.requests) == 1


def test_question_retries_once_briefly_on_a_server_error(tmp_path):
    fake = FakeGemini(failures=[503])
    embedder, sleeps = make_query_embedder(tmp_path, fake)
    assert asyncio.run(embedder.embed_query("q"))
    assert sleeps == [2.0] and len(fake.requests) == 2


def test_question_gives_up_after_two_tries(tmp_path):
    fake = FakeGemini(failures=[503, 503, 503])
    embedder, sleeps = make_query_embedder(tmp_path, fake)
    with pytest.raises(EmbeddingError):
        asyncio.run(embedder.embed_query("q"))
    assert len(fake.requests) == 2 and sum(sleeps) <= 2.0


def test_indexing_still_waits_for_a_long_rate_limit(tmp_path):
    embedder, sleeps = make(tmp_path, FakeGemini(failures=[429], retry_delay="37s"))
    asyncio.run(embedder.embed_documents(docs(1)))
    assert sleeps == [37.0]
    assert embedder.queries_paused_until == 0.0  # indexing does not pause questions


def test_bad_key_is_dropped_and_next_key_used(tmp_path, caplog):
    fake = FakeGemini(bad_keys={"AIzaFIRST1111"})
    embedder, _ = make(tmp_path, fake, keys=("AIzaFIRST1111", "AIzaSECOND222"))
    asyncio.run(embedder.embed_documents(docs(1)))
    assert [r.headers["x-goog-api-key"] for r in fake.requests] == ["AIzaFIRST1111", "AIzaSECOND222"]
    assert "****1111" in caplog.text and "AIzaFIRST1111" not in caplog.text


def test_finished_batches_stay_cached_when_a_later_batch_fails(tmp_path):
    fake = FakeGemini(fail_after_requests=1)  # batch 1 works, batch 2 keeps failing
    embedder, _ = make(tmp_path, fake)
    with pytest.raises(EmbeddingError):
        asyncio.run(embedder.embed_documents(docs(BATCH_SIZE + 1)))

    retry, _ = make(tmp_path, FakeGemini())
    asyncio.run(retry.embed_documents(docs(BATCH_SIZE + 1)))
    assert retry.cache_hits == BATCH_SIZE and retry.api_calls == 1


def test_demo_mode_never_calls(tmp_path):
    fake = FakeGemini()
    embedder, _ = make(tmp_path, fake, demo=True)
    assert asyncio.run(embedder.embed_documents(docs(2))) == [None, None]
    assert asyncio.run(embedder.embed_query("x")) is None
    assert fake.requests == []


# ---------- vector store ----------


def chunk(i: int) -> Chunk:
    return Chunk(id=f"a.py::f{i}::{i}", file="a.py", symbol=f"f{i}", kind="function",
                 start_line=i, end_line=i + 1, text=f"text {i}", node_id=f"func:a.py:f{i}")


def test_vector_store_query_and_replace(tmp_path):
    store = VectorStore.for_indexing(tmp_path / "chroma", MODEL)
    words = ["user lookup", "header parser", "save order"]
    store.replace_all([chunk(i) for i in range(3)], [fake_vector(w) for w in words])
    assert store.count() == 3

    best_id, similarity = store.query(fake_vector("parse header"), k=2)[0]
    assert best_id == "a.py::f1::1" and 0 < similarity <= 1

    store.replace_all([chunk(0)], [fake_vector("user lookup")])  # f1, f2 removed
    assert store.count() == 1


def test_query_with_a_different_model_is_refused(tmp_path):
    VectorStore.for_indexing(tmp_path / "chroma", MODEL).replace_all([chunk(0)], [fake_vector("x")])
    with pytest.raises(EmbeddingModelMismatch, match="Re-index"):
        VectorStore.for_query(tmp_path / "chroma", "other-embedding-model")
    assert VectorStore.for_query(tmp_path / "chroma", MODEL).count() == 1


def test_indexing_with_a_new_model_starts_over(tmp_path):
    VectorStore.for_indexing(tmp_path / "chroma", MODEL).replace_all([chunk(0)], [fake_vector("x")])
    store = VectorStore.for_indexing(tmp_path / "chroma", "other-embedding-model")
    assert store.count() == 0


def test_chroma_local_embedding_function_is_never_used(tmp_path):
    store = VectorStore.for_indexing(tmp_path / "chroma", MODEL)
    with pytest.raises(ValueError, match="embedding function"):
        store.collection.add(ids=["x"], documents=["text without a vector"])
