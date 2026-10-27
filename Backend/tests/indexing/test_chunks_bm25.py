"""Chunking, code-aware tokenizing, BM25."""

import pytest

from app.indexing.bm25 import build_bm25, load_bm25, save_bm25
from app.indexing.chunker import MODULE_SYMBOL, chunk_file, load_chunks, save_chunks
from app.indexing.files import list_source_files
from app.indexing.parser import parse_python
from app.indexing.tokenize import split_identifier, tokenize


def chunks_for(repo, path):
    source = (repo / path).read_bytes()
    lines = source.decode().splitlines()
    return chunk_file(parse_python(path, source, "h"), lines)


@pytest.fixture
def all_chunks(repo):
    return [c for f in list_source_files(repo) for c in chunks_for(repo, f.path)]


def test_function_and_module_chunks(repo):
    chunks = chunks_for(repo, "shop/db.py")
    assert [(c.symbol, c.kind, c.start_line, c.end_line) for c in chunks] == [
        (MODULE_SYMBOL, "module", 1, 5),
        ("get_user_by_id", "function", 8, 10),
        ("save_user", "function", 13, 14),
    ]
    get_user = chunks[1]
    assert get_user.text.splitlines()[0] == "# file: shop/db.py | symbol: get_user_by_id"
    assert get_user.text.splitlines()[1] == "def get_user_by_id(user_id: int) -> User | None:"
    assert get_user.node_id == "func:shop/db.py:get_user_by_id"
    assert get_user.id == "shop/db.py::get_user_by_id::8"


def test_class_header_and_methods(repo):
    chunks = chunks_for(repo, "shop/models.py")
    assert [(c.symbol, c.kind, c.start_line, c.end_line) for c in chunks] == [
        (MODULE_SYMBOL, "module", 1, 1),
        ("User", "class", 4, 10),  # decorator .. last field, stops before first method
        ("User.display_name", "method", 12, 14),
        ("User.to_dict", "method", 16, 17),
    ]


def test_module_chunk_collects_code_outside_definitions(repo):
    module = next(c for c in chunks_for(repo, "shop/api.py") if c.kind == "module")
    assert (module.start_line, module.end_line) == (1, 29)
    assert 'if __name__ == "__main__":' in module.text
    assert "def get_user" not in module.text


def test_empty_file_has_no_chunks(repo):
    assert chunks_for(repo, "shop/utils/__init__.py") == []


def test_chunks_round_trip(all_chunks, tmp_path):
    save_chunks(all_chunks, tmp_path / "chunks.json")
    assert load_chunks(tmp_path / "chunks.json") == all_chunks


@pytest.mark.parametrize(
    ("identifier", "parts"),
    [
        ("get_user_by_id", ["get", "user", "by", "id"]),
        ("getUserById", ["get", "user", "by", "id"]),
        ("parseHttpHeader", ["parse", "http", "header"]),
        ("HTTPServer", ["http", "server"]),
        ("__init__", ["init"]),
        ("v2_api", ["v", "2", "api"]),
    ],
)
def test_split_identifier(identifier, parts):
    assert split_identifier(identifier) == parts


def test_tokenize_keeps_identifier_drops_keywords_and_single_chars():
    tokens = tokenize("def get_user_by_id(x): return None if x else self")
    assert tokens == ["get_user_by_id", "get", "user", "by", "id", "self"]


def test_bm25_finds_function_by_word_inside_its_name(all_chunks):
    index = build_bm25(all_chunks)
    top_id, score = index.search("header", k=3)[0]
    assert top_id == "shop/utils/helpers.py::parseHttpHeader::6"
    assert score > 0
    assert index.search("lookup user by id", k=1)[0][0] == "shop/db.py::get_user_by_id::8"


def test_bm25_coverage_and_no_match(all_chunks):
    index = build_bm25(all_chunks)
    assert index.coverage("get user", "shop/db.py::get_user_by_id::8") == 1.0
    assert index.coverage("get banana", "shop/db.py::get_user_by_id::8") == 0.5
    assert index.search("kubernetes", k=5) == []


def test_bm25_save_load(all_chunks, tmp_path):
    index = build_bm25(all_chunks)
    save_bm25(index, tmp_path / "bm25.pkl")
    assert load_bm25(tmp_path / "bm25.pkl").search("header", 1) == index.search("header", 1)


def test_bm25_empty_repo():
    assert build_bm25([]).search("anything", 5) == []
