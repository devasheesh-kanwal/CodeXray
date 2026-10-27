"""Mock fixtures match the API models, and agree with each other."""

import re

import pytest
from pydantic import TypeAdapter

from app.api.schemas.llm import LlmStatus
from app.api.schemas.qa import AskResponse
from app.api.schemas.repos import (
    AddRepoResponse,
    FileSlice,
    RepoGraph,
    RepoStatus,
    RepoSummary,
    RepoTree,
    RulesResponse,
    TreeNode,
)
from app.api.schemas.repair import RepairRun, RepairStarted
from app.api.schemas.review import ReviewResponse
from app.mocks.loader import FIXTURE_MODELS, FIXTURES_DIR, get_fixture

# (method, url, json body, expected status, response model)
MOCK_RESPONSES = [
    ("get", "/api/repos", None, 200, list[RepoSummary]),
    ("post", "/api/repos", {"local_path": "C:/code/flask-todo"}, 202, AddRepoResponse),
    ("get", "/api/repos/r1/status", None, 200, RepoStatus),
    ("get", "/api/repos/r1/tree", None, 200, RepoTree),
    ("get", "/api/repos/r1/graph", None, 200, RepoGraph),
    ("get", "/api/repos/r1/file?path=app/auth.py&start=6&end=9", None, 200, FileSlice),
    ("post", "/api/repos/r1/ask", {"question": "How does auth work?"}, 200, AskResponse),
    ("post", "/api/repos/r1/review", {"diff_text": "--- a/x\n+++ b/x\n"}, 200, ReviewResponse),
    ("post", "/api/repos/r1/review", {"base_branch": "main", "head_branch": "feat"}, 200, ReviewResponse),
    ("get", "/api/repos/r1/rules", None, 200, RulesResponse),
    ("post", "/api/repos/r1/repair", {"issue": "Delete returns 500"}, 202, RepairStarted),
    ("get", "/api/llm/status", None, 200, LlmStatus),
]


def test_every_fixture_file_has_a_model():
    on_disk = {p.stem for p in FIXTURES_DIR.glob("*.json")}
    assert on_disk == set(FIXTURE_MODELS)


@pytest.mark.parametrize("name", sorted(FIXTURE_MODELS))
def test_fixture_validates_against_its_model(name):
    get_fixture.cache_clear()
    assert get_fixture(name) is not None


@pytest.mark.parametrize(("method", "url", "body", "status", "model"), MOCK_RESPONSES)
def test_mock_response_matches_model(client, method, url, body, status, model):
    resp = client.request(method, url, json=body)
    assert resp.status_code == status, resp.text
    TypeAdapter(model).validate_python(resp.json(), strict=False)


def test_tree_uses_requested_repo_id(client):
    assert client.get("/api/repos/my_repo/tree").json()["repo_id"] == "my_repo"


def test_ask_and_review_include_agent_trace(client):
    ask = client.post("/api/repos/r1/ask", json={"question": "q"}).json()
    review = client.post("/api/repos/r1/review", json={"diff_text": "d"}).json()
    assert len(ask["agent_trace"]) >= 2
    assert len(review["agent_trace"]) >= 2


def test_file_slice_returns_requested_lines(client):
    body = client.get("/api/repos/r1/file?path=app/auth.py&start=6&end=9").json()
    assert body["start"] == 6 and body["end"] == 9
    assert body["lines"][0] == "def verify_token(token):"
    assert len(body["lines"]) == 4


@pytest.mark.parametrize(
    "body",
    [{}, {"diff_text": "d", "base_branch": "main"}, {"base_branch": "main"}],
)
def test_review_rejects_bad_input(client, body):
    resp = client.post("/api/repos/r1/review", json=body)
    assert resp.status_code == 422


def test_add_repo_needs_exactly_one_source(client):
    both = {"git_url": "https://x/y.git", "local_path": "C:/y"}
    assert client.post("/api/repos", json=both).status_code == 422
    assert client.post("/api/repos", json={}).status_code == 422


# --- the fixtures describe one consistent demo repo ---


def all_files(node: TreeNode) -> list[TreeNode]:
    if node.type == "file":
        return [node]
    return [f for child in node.children for f in all_files(child)]


def test_tree_symbols_point_at_real_definitions():
    files = get_fixture("files").files
    tree_files = all_files(get_fixture("tree").root)
    assert {f.path for f in tree_files} == set(files)

    def check(path, symbols):
        for symbol in symbols:
            line = files[path][symbol.start_line - 1]
            keyword = "class" if symbol.kind == "class" else "def"
            assert f"{keyword} {symbol.name}" in line, (path, symbol.name)
            assert symbol.end_line <= len(files[path])
            check(path, symbol.children)

    for f in tree_files:
        check(f.path, f.symbols)


def test_graph_edges_use_known_nodes():
    graph = get_fixture("graph")
    files = get_fixture("files").files
    ids = {n.id for n in graph.nodes}
    assert all(n.file in files for n in graph.nodes)
    assert all(e.source in ids and e.target in ids for e in graph.edges)


def test_ask_citations_exist_and_match_markers():
    ask = get_fixture("ask")
    files = get_fixture("files").files
    for c in ask.citations:
        assert c.file in files
        assert 1 <= c.start_line <= c.end_line <= len(files[c.file])
    markers = re.findall(r"\[([^\[\]:]+):(\d+)-(\d+)\]", ask.answer)
    cited = {(c.file, c.start_line, c.end_line) for c in ask.citations}
    assert {(f, int(s), int(e)) for f, s, e in markers} == cited
    assert len(markers) == 3
