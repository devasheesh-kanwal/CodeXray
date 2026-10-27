"""Parser and skeleton: line ranges, imports, signatures, tree conversion."""

from pathlib import Path

from app.indexing.parser import parse_python
from app.indexing.skeleton import Skeleton, load_skeleton, save_skeleton, to_tree


def parse(repo, path):
    return parse_python(path, (repo / path).read_bytes(), "hash")


def test_function_line_ranges_signature_docstring(repo):
    skeleton = parse(repo, "shop/db.py")
    get_user = skeleton.functions[0]
    assert (get_user.name, get_user.start_line, get_user.end_line) == ("get_user_by_id", 8, 10)
    assert get_user.signature == "def get_user_by_id(user_id: int) -> User | None"
    assert get_user.docstring == "Look up one user."
    assert skeleton.line_count == 14
    assert [f.name for f in skeleton.functions] == ["get_user_by_id", "save_user"]


def test_class_with_methods_and_decorator(repo):
    skeleton = parse(repo, "shop/models.py")
    user = skeleton.classes[0]
    assert (user.name, user.start_line, user.end_line) == ("User", 4, 17)  # @dataclass on line 4
    assert user.decorators == ["dataclass"]
    assert user.docstring == "A shop customer."
    assert [(m.name, m.start_line, m.end_line) for m in user.methods] == [
        ("display_name", 12, 14),
        ("to_dict", 16, 17),
    ]
    assert user.methods[1].calls == ["self.display_name"]


def test_decorated_function_starts_at_decorator(repo):
    skeleton = parse(repo, "shop/api.py")
    get_user = next(f for f in skeleton.functions if f.name == "get_user")
    assert (get_user.start_line, get_user.end_line) == (15, 20)
    assert get_user.decorators == ["logged"]
    assert get_user.calls == ["find_user"]


def test_imports_absolute_relative_and_aliased(repo):
    skeleton = parse(repo, "shop/services.py")
    assert [(i.module, i.names, i.line) for i in skeleton.imports] == [
        ("shop", {"db": "db"}, 1),
        ("shop.models", {"User": "User"}, 2),
        (".utils.helpers", {"parseHttpHeader": "parseHttpHeader"}, 3),
    ]
    aliased = parse_python("x.py", b"import numpy as np\nfrom a import b as c\n", "h")
    assert (aliased.imports[0].module, aliased.imports[0].alias) == ("numpy", "np")
    assert aliased.imports[1].names == {"c": "b"}


def test_call_names(repo):
    services = parse(repo, "shop/services.py")
    calls = {f.name: f.calls for f in services.functions}
    assert calls["register_user"] == ["User", "db.save_user"]
    assert calls["user_agent"] == ["?.get", "parseHttpHeader"]


def test_parses_every_file_of_this_backend():
    """Regression: tree-sitter 0.26.0 crashed the process on app/indexing/graph.py."""
    app_dir = Path(__file__).resolve().parents[2] / "app"
    files = sorted(app_dir.rglob("*.py"))
    for path in files:
        skeleton = parse_python(path.name, path.read_bytes(), "h")
        assert not skeleton.parse_error, path
    assert len(files) > 40


def test_syntax_error_is_flagged_not_fatal():
    skeleton = parse_python("bad.py", b"def ok():\n    return 1\n\ndef broken(:\n", "h")
    assert skeleton.parse_error
    assert skeleton.functions[0].name == "ok"


def test_tree_conversion_and_round_trip(repo, tmp_path):
    files = [parse(repo, p) for p in ["shop/db.py", "shop/models.py", "shop/utils/helpers.py"]]
    skeleton = Skeleton(repo_id="shop-1", name="sample_repo", files=files)
    save_skeleton(skeleton, tmp_path / "skeleton.json")
    tree = to_tree(load_skeleton(tmp_path / "skeleton.json"))

    assert tree.repo_id == "shop-1" and tree.root.name == "sample_repo"
    shop = tree.root.children[0]
    assert (shop.path, shop.type) == ("shop", "folder")
    assert [c.path for c in shop.children] == ["shop/db.py", "shop/models.py", "shop/utils"]
    models = shop.children[1]
    assert models.symbols[0].kind == "class"
    assert [m.kind for m in models.symbols[0].children] == ["method", "method"]
    assert shop.children[2].children[0].path == "shop/utils/helpers.py"
