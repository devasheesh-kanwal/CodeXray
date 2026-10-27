"""Import edges, call edges with confidence, neighbors, storage, API shape."""

import pytest

from app.indexing.files import list_source_files
from app.indexing.graph import (
    absolute_module,
    build_graph,
    load_graph,
    module_names,
    neighbors,
    save_graph,
    to_api,
)
from app.indexing.parser import parse_python
from app.indexing.skeleton import Skeleton


@pytest.fixture
def graph(repo):
    files = [
        parse_python(f.path, f.abs_path.read_bytes(), f.sha256) for f in list_source_files(repo)
    ]
    return build_graph(Skeleton(repo_id="shop-1", name="shop", files=files))


def edges(graph, kind):
    return {(s, t) for s, t, a in graph.edges(data=True) if a["type"] == kind}


def test_module_names_and_relative_imports():
    assert module_names("shop/db.py") == ["shop.db"]
    assert module_names("shop/__init__.py") == ["shop"]
    assert module_names("src/pkg/a.py") == ["src.pkg.a", "pkg.a"]
    assert absolute_module(".utils.helpers", "shop/services.py") == "shop.utils.helpers"
    assert absolute_module("..models", "shop/utils/helpers.py") == "shop.models"
    assert absolute_module("os", "shop/db.py") == "os"


def test_import_edges_resolve_local_files_only(graph):
    assert edges(graph, "imports") == {
        ("file:shop/api.py", "file:shop/services.py"),
        ("file:shop/db.py", "file:shop/models.py"),
        ("file:shop/services.py", "file:shop/db.py"),          # from shop import db
        ("file:shop/services.py", "file:shop/models.py"),
        ("file:shop/services.py", "file:shop/utils/helpers.py"),  # relative import
    }


def test_call_edges_with_confidence(graph):
    calls = {
        (s, t): a["confidence"] for s, t, a in graph.edges(data=True) if a["type"] == "calls"
    }
    assert calls == {
        # module attribute on an imported module
        ("func:shop/services.py:register_user", "func:shop/db.py:save_user"): "exact",
        ("func:shop/services.py:find_user", "func:shop/db.py:get_user_by_id"): "exact",
        # imported class (constructor call)
        ("func:shop/services.py:register_user", "class:shop/models.py:User"): "exact",
        # name imported with 'from ... import'
        ("func:shop/services.py:user_agent", "func:shop/utils/helpers.py:parseHttpHeader"): "exact",
        ("func:shop/api.py:get_user", "func:shop/services.py:find_user"): "exact",
        ("func:shop/api.py:create_user", "func:shop/services.py:register_user"): "exact",
        # self.method() in the same class
        ("func:shop/models.py:User.to_dict", "func:shop/models.py:User.display_name"): "exact",
        # user.to_dict(): only one to_dict among the imported modules
        ("func:shop/services.py:find_user", "func:shop/models.py:User.to_dict"): "name_match",
    }


def test_contains_edges(graph):
    contains = edges(graph, "contains")
    assert ("file:shop/models.py", "class:shop/models.py:User") in contains
    assert ("class:shop/models.py:User", "func:shop/models.py:User.to_dict") in contains


def test_neighbors(graph):
    found = neighbors(graph, "func:shop/services.py:find_user")
    assert found["callers"] == ["func:shop/api.py:get_user"]
    assert found["callees"] == ["func:shop/db.py:get_user_by_id", "func:shop/models.py:User.to_dict"]

    two_hops = neighbors(graph, "func:shop/db.py:get_user_by_id", hops=2)
    assert two_hops["callers"] == ["func:shop/api.py:get_user", "func:shop/services.py:find_user"]
    assert neighbors(graph, "func:nope") == {"callers": [], "callees": []}


def test_save_load_and_api_shape(graph, tmp_path):
    save_graph(graph, tmp_path / "graph.json")
    loaded = load_graph(tmp_path / "graph.json")
    assert set(loaded.edges) == set(graph.edges)

    api = to_api(loaded)
    types = {n.id: n.type for n in api.nodes}
    assert types["func:shop/models.py:User.to_dict"] == "function"  # methods map to function
    assert types["class:shop/models.py:User"] == "class"
    assert all(not hasattr(e, "confidence") for e in api.edges)
