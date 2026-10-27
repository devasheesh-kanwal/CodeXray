"""Full pipeline (re-indexing, fallbacks, summaries) and the real repo endpoints."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.api.schemas.repos import FileSlice, RepoGraph, RepoStatus, RepoTree
from app.indexing.intake import RepoMeta, load_meta, repo_id_for, save_meta
from app.indexing.pipeline import Indexer, make_embedder
from app.indexing.service import IndexService
from app.llm import LLMRouter
from app.llm.routes import LaneEntry
from app.main import create_app
from tests.conftest import make_settings
from tests.indexing.fakes import FakeGemini
from tests.llm.fakes import FakeProviders, ok


async def no_sleep(_seconds):
    return None


def settings_for(tmp_path, **overrides):
    values = {"mock_mode": False, "gemini_api_keys": "AIzaTEST1234", "data_dir": tmp_path / "data"}
    values.update(overrides)
    return make_settings(tmp_path, **values)


def run_index(tmp_path, repo, fake=None, router=None, **overrides):
    settings = settings_for(tmp_path, **overrides)
    fake = fake or FakeGemini()
    embedder = make_embedder(settings, transport=fake.transport(), sleep=no_sleep)
    service = IndexService(settings, router, embedder)
    meta = service.add_repo(None, str(repo))
    report = asyncio.run(Indexer(settings, router, embedder).run(meta))
    return report, load_meta(settings.data_path, meta.repo_id), service


# ---------- pipeline ----------


def test_full_index_builds_every_artifact(tmp_path, repo):
    report, meta, _ = run_index(tmp_path, repo)
    assert meta.stage == "ready" and meta.search_mode == "hybrid"
    assert (meta.files_done, meta.files_total) == (7, 7)
    assert meta.chunks_embedded == meta.chunks_total == report.chunks_total > 10
    assert report.embedding_api_calls == 1  # all chunks fit in one batch
    folder = tmp_path / "data" / meta.repo_id
    for name in ["meta.json", "skeleton.json", "graph.json", "chunks.json", "bm25.pkl", "chroma"]:
        assert (folder / name).exists(), name
    assert set(report.timings) == {"parsing", "graph", "bm25", "embedding"}


def test_reindex_skips_unchanged_files_and_embeddings(tmp_path, repo):
    run_index(tmp_path, repo)
    report, _, _ = run_index(tmp_path, repo)
    assert (report.files_parsed, report.files_reused) == (0, 7)
    assert report.embedding_api_calls == 0

    (repo / "shop" / "db.py").write_text(
        (repo / "shop" / "db.py").read_text() + "\n\ndef delete_user(user_id):\n    USERS.pop(user_id)\n"
    )
    report, meta, _ = run_index(tmp_path, repo)
    assert (report.files_parsed, report.files_reused) == (1, 6)
    assert report.embedding_api_calls == 1
    # Only the new function's chunk is new text; every other chunk (even db.py's
    # module-level chunk, whose code didn't change) comes from the embedding cache.
    assert report.embedding_cache_hits == meta.chunks_total - 1


def test_embedding_failure_finishes_as_bm25_only(tmp_path, repo):
    report, meta, service = run_index(tmp_path, repo, fake=FakeGemini(failures=[429] * 10))
    assert meta.stage == "ready" and meta.search_mode == "bm25_only"
    assert meta.chunks_embedded == 0
    assert report.embedding_api_calls == 5
    result = asyncio.run(service.searcher(meta.repo_id).search("parse header", 3))
    assert result.hits[0].symbol == "parseHttpHeader" and result.mode == "bm25_only"


def test_embeddings_false_makes_no_calls(tmp_path, repo):
    fake = FakeGemini()
    _, meta, _ = run_index(tmp_path, repo, fake=fake, embeddings=False)
    assert meta.search_mode == "bm25_only" and fake.requests == []


def test_no_gemini_keys_is_bm25_only(tmp_path, repo):
    fake = FakeGemini()
    _, meta, _ = run_index(tmp_path, repo, fake=fake, gemini_api_keys="")
    assert meta.search_mode == "bm25_only" and fake.requests == []


def test_hybrid_searcher_after_indexing(tmp_path, repo):
    _, meta, service = run_index(tmp_path, repo)
    result = asyncio.run(service.searcher(meta.repo_id).search("save user", 3))
    assert result.mode == "hybrid" and result.hits[0].symbol == "save_user"


def test_searcher_refuses_vectors_from_another_model(tmp_path, repo):
    _, meta, _ = run_index(tmp_path, repo)
    other = IndexService(settings_for(tmp_path, gemini_embedding_model="other-model"))
    assert other.searcher(meta.repo_id).vectors is None  # falls back to BM25, never mixes models


def summary_router(tmp_path) -> tuple[LLMRouter, FakeProviders]:
    fake = FakeProviders()
    fake.on("summarizer", ok("Stores users in memory.\nextra line"))
    router = LLMRouter(
        make_settings(tmp_path / "llm", groq_api_keys="gsk_test1234"),
        lanes={"fast_small": [LaneEntry(provider="groq", model="summarizer", max_context=100_000)]},
        transport=fake.transport(),
    )
    return router, fake


def test_file_summaries_only_when_enabled(tmp_path, repo):
    router, fake = summary_router(tmp_path)
    run_index(tmp_path, repo, router=router)
    assert fake.calls == []  # FILE_SUMMARIES=false by default

    report, meta, service = run_index(tmp_path, repo, router=router, file_summaries=True)
    skeleton = service.skeleton(meta.repo_id)
    assert skeleton.file("shop/db.py").summary == "Stores users in memory."
    assert skeleton.file("shop/utils/__init__.py").summary is None  # empty file: no call
    assert len(fake.calls) == 6
    assert "summaries" in report.timings

    run_index(tmp_path, repo, router=router, file_summaries=True)
    assert len(fake.calls) == 6  # unchanged files keep their summary


# ---------- API (MOCK_MODE=false) ----------


@pytest.fixture
def api(tmp_path):
    settings = settings_for(tmp_path)
    app = create_app(settings)
    embedder = make_embedder(settings, transport=FakeGemini().transport(), sleep=no_sleep)
    app.state.index_service = IndexService(settings, None, embedder)
    return TestClient(app)


def add(api, repo) -> str:
    response = api.post("/api/repos", json={"local_path": str(repo)})
    assert response.status_code == 202, response.text
    assert response.json()["status"] == "queued"
    return response.json()["repo_id"]


def test_add_repo_indexes_in_background_and_reports_status(api, repo):
    repo_id = add(api, repo)  # TestClient runs the background task before returning
    assert repo_id == repo_id_for(str(repo.resolve()))
    status = RepoStatus.model_validate(api.get(f"/api/repos/{repo_id}/status").json())
    assert status.stage == "ready" and status.search_mode == "hybrid"
    assert status.files_done == status.files_total == 7
    assert status.chunks_embedded == status.chunks_total

    repos = api.get("/api/repos").json()
    assert repos == [{"repo_id": repo_id, "name": "sample_repo", "status": "ready", "files_total": 7}]


def test_tree_graph_and_file_are_real(api, repo):
    repo_id = add(api, repo)
    tree = RepoTree.model_validate(api.get(f"/api/repos/{repo_id}/tree").json())
    assert tree.root.children[0].path == "shop"

    graph = RepoGraph.model_validate(api.get(f"/api/repos/{repo_id}/graph").json())
    assert any(e.type == "calls" for e in graph.edges)

    body = api.get(f"/api/repos/{repo_id}/file", params={"path": "shop/db.py", "start": 8, "end": 10})
    file_slice = FileSlice.model_validate(body.json())
    assert file_slice.lines[0] == "def get_user_by_id(user_id: int) -> User | None:"


@pytest.mark.parametrize(
    "path",
    ["../../secret.py", "shop/../../outside.py", "shop\\..\\..\\outside.py", "/etc/passwd",
     "C:/Windows/win.ini", ".gitignore", "shop/missing.py"],
)
def test_file_outside_index_is_404(api, repo, path):
    repo_id = add(api, repo)
    response = api.get(f"/api/repos/{repo_id}/file", params={"path": path})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_unknown_repo_is_404(api):
    for url in ["/api/repos/nope-1234/status", "/api/repos/nope-1234/tree", "/api/repos/../x/tree"]:
        assert api.get(url).status_code == 404


def test_not_yet_indexed_repo_is_409(api, tmp_path):
    settings = api.app.state.settings
    save_meta(settings.data_path, RepoMeta(repo_id="queued-1", name="q", source="/q",
                                           kind="local", root="/q"))
    response = api.get("/api/repos/queued-1/tree")
    assert response.status_code == 409 and response.json()["error"]["code"] == "INVALID_STATE"


@pytest.mark.parametrize(
    "body",
    [{"local_path": "Z:/definitely/missing/folder"}, {"git_url": "--upload-pack=touch /tmp/x"}],
)
def test_bad_sources_are_422(api, body):
    response = api.post("/api/repos", json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_adding_a_repo_that_is_indexing_is_409(api, repo):
    service = api.app.state.index_service
    service.running.add(repo_id_for(str(repo.resolve())))
    assert api.post("/api/repos", json={"local_path": str(repo)}).status_code == 409


def test_interrupted_indexing_is_marked_failed(tmp_path):
    settings = settings_for(tmp_path)
    save_meta(settings.data_path, RepoMeta(repo_id="half-1", name="h", source="/h",
                                           kind="local", root="/h", stage="embedding"))
    create_app(settings)
    meta = load_meta(settings.data_path, "half-1")
    assert meta.stage == "failed" and "restart" in meta.error
