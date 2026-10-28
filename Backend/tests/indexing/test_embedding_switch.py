"""NVIDIA embeddings and switching between Gemini and NVIDIA by hand."""

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app.indexing.embedder import NVIDIA_DIMENSIONS, EmbeddingCache, NvidiaEmbedder
from app.indexing.intake import load_meta, repo_dir
from app.indexing.pipeline import make_embedders
from app.indexing.service import IndexService
from app.indexing.vector_store import EmbeddingModelMismatch, VectorStore
from app.main import create_app
from tests.indexing.fakes import FakeGemini, FakeNvidia, both_transport, fake_vector
from tests.indexing.test_embeddings import chunk
from tests.indexing.test_pipeline_api import no_sleep, settings_for

NV_MODEL = "nvidia/nemotron-3.5-embed-1b"


def nvidia(tmp_path, fake):
    return NvidiaEmbedder(NV_MODEL, ["nvapi-TEST9999"], EmbeddingCache(tmp_path / "cache.sqlite"),
                          transport=fake.transport(), sleep=no_sleep)


def test_nvidia_request_format_and_order(tmp_path):
    fake = FakeNvidia()
    embedder = nvidia(tmp_path, fake)
    vectors = asyncio.run(embedder.embed_documents([("a.py::f", "def save_user(): pass"), ("b.py::g", "x")]))

    request = fake.requests[0]
    assert str(request.url) == "https://integrate.api.nvidia.com/v1/embeddings"
    assert request.headers["authorization"] == "Bearer nvapi-TEST9999"
    body = json.loads(request.content)
    assert body["model"] == NV_MODEL and body["input_type"] == "passage"
    assert body["dimensions"] == NVIDIA_DIMENSIONS and body["input"][0] == "a.py::f\ndef save_user(): pass"
    # The fake answers in reverse order; vectors come back in input order.
    assert vectors[0] == pytest.approx(fake_vector(body["input"][0], NVIDIA_DIMENSIONS))


def test_nvidia_queries_use_query_type_and_their_own_cache_entry(tmp_path):
    fake = FakeNvidia()
    embedder = nvidia(tmp_path, fake)
    asyncio.run(embedder.embed_documents([("t", "user")]))
    asyncio.run(embedder.embed_query("t\nuser"))  # same text as the document
    assert [json.loads(r.content)["input_type"] for r in fake.requests] == ["passage", "query"]


def test_nvidia_retries_on_429(tmp_path):
    fake = FakeNvidia(failures=[429])
    assert asyncio.run(nvidia(tmp_path, fake).embed_documents([("t", "x")]))[0]
    assert len(fake.requests) == 2


def test_two_models_keep_separate_collections(tmp_path):
    path = tmp_path / "chroma"
    VectorStore.for_indexing(path, "gemini-embedding-2").replace_all([chunk(0)], [fake_vector("x")])
    VectorStore.for_indexing(path, NV_MODEL).replace_all(
        [chunk(0), chunk(1)], [fake_vector("x", NVIDIA_DIMENSIONS), fake_vector("y", NVIDIA_DIMENSIONS)])
    assert VectorStore.for_query(path, "gemini-embedding-2").count() == 1
    assert VectorStore.for_query(path, NV_MODEL).count() == 2
    with pytest.raises(EmbeddingModelMismatch):
        VectorStore.for_query(path, "third-model")


def switching_service(tmp_path, gemini, nv):
    settings = settings_for(tmp_path, nvidia_api_keys="nvapi-TEST9999")
    service = IndexService(settings)
    service.embedders = make_embedders(settings, transport=both_transport(gemini, nv), sleep=no_sleep)
    return service


def test_switching_adds_vectors_in_the_background_and_keeps_the_old_ones(tmp_path, repo):
    gemini, nv = FakeGemini(), FakeNvidia()
    service = switching_service(tmp_path, gemini, nv)
    meta = service.add_repo(None, str(repo))

    async def scenario():
        await service.index(meta.repo_id)
        assert service.searcher(meta.repo_id).embedder.provider == "gemini"

        assert service.select_embedding("nvidia") == [meta.repo_id]
        assert service.searcher(meta.repo_id).vectors is None  # BM25 until the NVIDIA vectors exist
        assert service.status(meta.repo_id).search_mode == "bm25_only"
        await asyncio.gather(*service._tasks)

        result = await service.searcher(meta.repo_id).search("save user", 3)
        assert result.mode == "hybrid" and result.embedding_provider == "nvidia"
        assert service.status(meta.repo_id).search_mode == "hybrid"

        gemini_calls = len(gemini.requests)
        assert service.select_embedding("gemini") == []  # its vectors are still there
        assert service.searcher(meta.repo_id).embedder.provider == "gemini"
        assert len(gemini.requests) == gemini_calls

    asyncio.run(scenario())
    saved = load_meta(service.data_dir, meta.repo_id)
    assert set(saved.embedded_models) == {"gemini-embedding-2", NV_MODEL}


def test_reindexing_drops_vectors_of_the_other_model(tmp_path, repo):
    service = switching_service(tmp_path, FakeGemini(), FakeNvidia())
    meta = service.add_repo(None, str(repo))

    async def scenario():
        await service.index(meta.repo_id)
        service.select_embedding("nvidia")
        await asyncio.gather(*service._tasks)
        service.add_repo(None, str(repo))
        await service.index(meta.repo_id)  # with NVIDIA: the chunks may have changed

    asyncio.run(scenario())
    assert load_meta(service.data_dir, meta.repo_id).embedded_models == [NV_MODEL]


def test_old_meta_without_embedded_models_still_counts_as_hybrid(tmp_path, repo):
    service = switching_service(tmp_path, FakeGemini(), FakeNvidia())
    meta = service.add_repo(None, str(repo))
    asyncio.run(service.index(meta.repo_id))
    path = repo_dir(service.data_dir, meta.repo_id) / "meta.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data.pop("embedded_models")
    path.write_text(json.dumps(data), encoding="utf-8")
    assert load_meta(service.data_dir, meta.repo_id).embedded_models == ["gemini-embedding-2"]


def test_embeddings_endpoints(tmp_path):
    client = TestClient(create_app(settings_for(tmp_path, nvidia_api_keys="nvapi-TEST9999")))
    body = client.get("/api/embeddings").json()
    assert body["selected"] == "gemini" and {p["id"] for p in body["providers"]} == {"gemini", "nvidia"}
    assert "TEST" not in json.dumps(body)  # never a key

    body = client.put("/api/embeddings/selection", json={"provider": "nvidia"}).json()
    assert body["selected"] == "nvidia"
    assert client.put("/api/embeddings/selection", json={"provider": "openai"}).status_code == 422
