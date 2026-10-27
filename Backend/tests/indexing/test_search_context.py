"""Hybrid search (RRF) and the context manager budget."""

import asyncio

import pytest

from app.indexing.context import (
    KEEP_HEAD_LINES,
    KEEP_TAIL_LINES,
    build_context,
    estimate_tokens,
    snippets_for_ranges,
)
from app.indexing.embedder import EmbeddingCache, GeminiEmbedder
from app.indexing.search import RepoSearch, reciprocal_rank_fusion
from app.indexing.vector_store import VectorStore
from tests.indexing.conftest import build_parts
from tests.indexing.fakes import FakeGemini


def hybrid(parts, tmp_path, fake=None):
    fake = fake or FakeGemini()
    embedder = GeminiEmbedder("gemini-embedding-2", ["AIzaKEY0000"],
                              EmbeddingCache(tmp_path / "cache.sqlite"), transport=fake.transport())
    vectors = asyncio.run(embedder.embed_documents([(c.id, c.text) for c in parts.chunks]))
    store = VectorStore.for_indexing(tmp_path / "chroma", "gemini-embedding-2")
    store.replace_all(parts.chunks, vectors)
    return RepoSearch(parts.chunks, parts.bm25, store, embedder)


def test_rrf_rewards_agreement():
    scores = reciprocal_rank_fusion([["a", "b"], ["b", "c"]])
    assert max(scores, key=scores.get) == "b"
    assert scores["a"] == pytest.approx(1 / 61)


def test_bm25_only_search(repo):
    parts = build_parts(repo)
    result = asyncio.run(RepoSearch(parts.chunks, parts.bm25).search("parse http header", k=3))
    top = result.hits[0]
    assert (top.file, top.symbol, top.start_line, top.end_line) == (
        "shop/utils/helpers.py", "parseHttpHeader", 6, 13,
    )
    assert top.method == "bm25" and result.mode == "bm25_only"
    assert result.best_score == 1.0  # every query word is in that chunk


def test_hybrid_search_marks_methods(repo, tmp_path):
    parts = build_parts(repo)
    result = asyncio.run(hybrid(parts, tmp_path).search("save user", k=5))
    assert result.mode == "hybrid"
    assert result.hits[0].symbol == "save_user"
    assert result.hits[0].method == "both"
    assert {h.method for h in result.hits} <= {"bm25", "vector", "both"}
    assert 0 < result.best_score <= 1


def test_unrelated_query_has_low_best_score(repo, tmp_path):
    parts = build_parts(repo)
    result = asyncio.run(hybrid(parts, tmp_path).search("kubernetes helm chart", k=5))
    assert result.best_score < 0.3


def test_query_embedding_failure_falls_back_to_bm25(repo, tmp_path):
    parts = build_parts(repo)
    search = hybrid(parts, tmp_path)
    search.embedder.transport = FakeGemini(failures=[500] * 10).transport()

    async def no_sleep(_):
        return None

    search.embedder.sleep = no_sleep
    result = asyncio.run(search.search("parse header", k=3))
    assert result.hits[0].symbol == "parseHttpHeader"
    assert all(h.method == "bm25" for h in result.hits)


# ---------- context manager ----------


def test_context_has_hits_then_neighbors_with_labels(repo):
    parts = build_parts(repo)
    search = RepoSearch(parts.chunks, parts.bm25)
    context = asyncio.run(build_context(search, parts.graph, ["find user"], token_budget=5000, top_k=1))

    first = context.snippets[0]
    assert (first.symbol, first.source) == ("find_user", "search")
    assert first.label == "[shop/services.py:13-17]"
    assert first.text.startswith("def find_user(user_id: int) -> dict | None:")
    neighbors = {s.symbol for s in context.snippets if s.source == "neighbor"}
    assert neighbors == {"get_user", "get_user_by_id", "User.to_dict"}
    assert context.best_score > 0


def test_context_respects_token_budget(repo):
    parts = build_parts(repo)
    search = RepoSearch(parts.chunks, parts.bm25)
    full = asyncio.run(build_context(search, parts.graph, ["user"], token_budget=100_000))
    assert len(full.snippets) > 3

    budget = estimate_tokens(full.snippets[0].render()) + 5
    small = asyncio.run(build_context(search, parts.graph, ["user"], token_budget=budget))
    assert small.tokens_used <= budget
    assert small.snippets[0].label == full.snippets[0].label
    assert sum(estimate_tokens(s.render()) for s in small.snippets) == small.tokens_used

    assert asyncio.run(build_context(search, parts.graph, ["user"], token_budget=0)).snippets == []


def test_long_function_is_cut_with_marker(repo):
    body = "\n".join(f"    step_{i} = {i}" for i in range(100))
    (repo / "shop" / "long.py").write_text(f"def very_long_routine():\n{body}\n    return step_99\n")
    parts = build_parts(repo)
    search = RepoSearch(parts.chunks, parts.bm25)
    context = asyncio.run(build_context(search, parts.graph, ["very long routine"], 5000, top_k=1))

    snippet = context.snippets[0]
    assert snippet.truncated and snippet.label == "[shop/long.py:1-102]"
    lines = snippet.text.splitlines()
    assert lines[0] == "def very_long_routine():"
    assert lines[KEEP_HEAD_LINES] == "    # ... lines 21-92 cut ..."
    assert lines[-1] == "    return step_99"
    assert len(lines) == KEEP_HEAD_LINES + 1 + KEEP_TAIL_LINES


def test_snippets_for_ranges_clamps_merges_and_skips_unknown_files():
    files = {"a.py": [f"line {n}" for n in range(1, 11)]}
    read = lambda path: files.get(path, [])  # noqa: E731
    ranges = [("a.py", 2, 4), ("ghost.py", 1, 5), ("a.py", 3, 6), ("a.py", 9, 50), ("a.py", 20, 30)]
    snippets = snippets_for_ranges(read, ranges, token_budget=1000)
    assert [s.label for s in snippets] == ["[a.py:2-6]", "[a.py:9-10]"]
    assert snippets[0].text.splitlines() == ["line 2", "line 3", "line 4", "line 5", "line 6"]
    assert {s.source for s in snippets} == {"selected"}


def test_snippets_for_ranges_respects_budget():
    files = {"a.py": ["x = 1"] * 10, "b.py": ["y = 2"] * 10}
    read = lambda path: files.get(path, [])  # noqa: E731
    one = snippets_for_ranges(read, [("a.py", 1, 10)], 1000)[0]
    budget = estimate_tokens(one.render())
    snippets = snippets_for_ranges(read, [("a.py", 1, 10), ("b.py", 1, 10)], budget)
    assert [s.label for s in snippets] == ["[a.py:1-10]"]


def test_several_queries_are_merged(repo):
    parts = build_parts(repo)
    search = RepoSearch(parts.chunks, parts.bm25)
    context = asyncio.run(
        build_context(search, parts.graph, ["parse header", "save user"], 5000, top_k=2)
    )
    found = {s.symbol for s in context.snippets if s.source == "search"}
    assert found == {"parseHttpHeader", "save_user"}
