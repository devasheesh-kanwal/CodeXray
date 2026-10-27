"""Skip rules, hashing, repo ids, URL checks, meta.json."""

import pytest

from app.indexing.files import MAX_FILE_BYTES, list_source_files
from app.indexing.intake import (
    IndexingError,
    RepoMeta,
    check_git_url,
    list_metas,
    load_meta,
    normalize_local_path,
    repo_id_for,
    repo_name,
    save_meta,
)

SAMPLE_FILES = [
    "shop/__init__.py",
    "shop/api.py",
    "shop/db.py",
    "shop/models.py",
    "shop/services.py",
    "shop/utils/__init__.py",
    "shop/utils/helpers.py",
]


def paths(root):
    return [f.path for f in list_source_files(root)]


def test_lists_python_files_sorted(repo):
    assert paths(repo) == SAMPLE_FILES


@pytest.mark.parametrize(
    "junk",
    [
        ".git/hooks/x.py",
        "venv/lib/x.py",
        ".venv/lib/x.py",
        "node_modules/pkg/x.py",
        "shop/__pycache__/x.py",
        "build/x.py",
        "dist/x.py",
        "secrets/keys.py",      # ignored by .gitignore (folder)
        "shop/debug.log",       # ignored by .gitignore (pattern); also not .py
        "README.md",            # not Python
    ],
)
def test_skip_rules(repo, junk):
    target = repo / junk
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("x = 1\n")
    assert paths(repo) == SAMPLE_FILES


def test_env_big_and_binary_files_are_skipped(repo):
    (repo / ".env").write_text("KEY=secret\n")
    (repo / "big.py").write_text("x = 1\n" * (MAX_FILE_BYTES // 6 + 10))
    (repo / "blob.py").write_bytes(b"x = 1\x00\x01\x02")
    assert paths(repo) == SAMPLE_FILES


def test_nested_gitignore(repo):
    (repo / "shop" / ".gitignore").write_text("generated_*.py\n")
    (repo / "shop" / "generated_api.py").write_text("x = 1\n")
    (repo / "generated_top.py").write_text("x = 1\n")  # outside shop/: not ignored
    assert "shop/generated_api.py" not in paths(repo)
    assert "generated_top.py" in paths(repo)


def test_hash_changes_only_when_content_changes(repo):
    before = {f.path: f.sha256 for f in list_source_files(repo)}
    (repo / "shop" / "db.py").write_text("# changed\n")
    after = {f.path: f.sha256 for f in list_source_files(repo)}
    changed = [p for p in before if before[p] != after[p]]
    assert changed == ["shop/db.py"]


def test_repo_ids_are_stable_and_readable():
    url = "https://github.com/someone/Flask-Todo.git"
    assert repo_name(url) == "Flask-Todo"
    assert repo_id_for(url) == repo_id_for(url)
    assert repo_id_for(url).startswith("flask-todo-")
    assert repo_id_for(url) != repo_id_for("https://github.com/other/Flask-Todo.git")
    assert repo_name(r"C:\code\shop") == "shop"


@pytest.mark.parametrize(
    "url", ["https://github.com/a/b.git", "git@github.com:a/b.git", "ssh://git@host/a/b"]
)
def test_valid_git_urls(url):
    assert check_git_url(url) == url


@pytest.mark.parametrize(
    "url", ["--upload-pack=evil", "file:///etc", "http://insecure/a.git", "C:/repo", "https://a b"]
)
def test_bad_git_urls_are_rejected(url):
    with pytest.raises(IndexingError):
        check_git_url(url)


def test_local_path_must_be_a_folder(tmp_path):
    assert normalize_local_path(str(tmp_path)) == tmp_path.resolve()
    with pytest.raises(IndexingError):
        normalize_local_path(str(tmp_path / "missing"))


def test_meta_round_trip(tmp_path):
    meta = RepoMeta(repo_id="shop-1", name="shop", source="/x", kind="local", root="/x")
    save_meta(tmp_path, meta)
    (tmp_path / "repos").mkdir()  # folders without meta.json are ignored
    assert load_meta(tmp_path, "shop-1").name == "shop"
    assert [m.repo_id for m in list_metas(tmp_path)] == ["shop-1"]
    assert load_meta(tmp_path, "nope") is None
