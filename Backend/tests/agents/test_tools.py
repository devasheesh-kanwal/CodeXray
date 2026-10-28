"""Tool registry: permissions, validation, truncation, and each tool."""

import asyncio
import subprocess

import pytest
from pydantic import BaseModel

from app.agents.tools import (
    Tool,
    ToolContext,
    ToolRegistry,
    ToolResult,
    default_registry,
    is_test_path,
    patched_paths,
)

class NoArgs(BaseModel):
    pass


ALL = ["search_code", "read_skeleton", "get_neighbors", "read_file", "read_test_output", "write_patch"]


def call(ctx, name, args, allowed=ALL, agent="tester") -> ToolResult:
    return asyncio.run(default_registry().call(name, args, ctx, allowed, agent))


# ---------- registry ----------


def test_denied_tool_is_refused_and_never_runs(ctx, caplog):
    ran = []
    registry = ToolRegistry([Tool("danger", "x", NoArgs, lambda c, a: ran.append(1), 10)])
    result = asyncio.run(registry.call("danger", {}, ctx, allowed=["search_code"], agent="architect"))
    assert not result.ok and "not allowed for agent 'architect'" in result.text
    assert ran == []
    assert "architect tried tool danger" in caplog.text


def test_unknown_tool_and_bad_args(ctx):
    assert "no tool named" in call(ctx, "rm_rf", {}, allowed=["rm_rf"]).text
    bad = call(ctx, "search_code", {"query": ""})
    assert not bad.ok and "invalid arguments" in bad.text
    broken_json = call(ctx, "search_code", "{not json")
    assert not broken_json.ok


def test_long_results_are_truncated(ctx):
    registry = ToolRegistry(
        [Tool("big", "x", NoArgs, lambda c, a: ToolResult("y" * 1000, "big"), max_result_tokens=10)]
    )
    result = asyncio.run(registry.call("big", {}, ctx, allowed=["big"], agent="t"))
    assert result.text == "y" * 40 + "\n[truncated]"


def test_openai_specs():
    specs = default_registry().specs(["search_code", "read_file"])
    assert [s["function"]["name"] for s in specs] == ["search_code", "read_file"]
    assert specs[0]["function"]["parameters"]["properties"]["query"]["type"] == "string"


# ---------- read-only tools ----------


def test_search_code_works_in_bm25_only_mode(ctx):
    result = call(ctx, "search_code", {"query": "parse http header", "k": 3})
    assert result.ok
    assert result.text.startswith("mode: bm25_only")
    assert "shop/utils/helpers.py:6-13 parseHttpHeader" in result.text
    assert "found_by bm25" in result.text
    assert "def parseHttpHeader(raw: str)" in result.text
    assert result.summary.startswith("3 results (bm25_only); top shop/utils/helpers.py:6-13")


def test_search_code_no_results(ctx):
    assert call(ctx, "search_code", {"query": "kubernetes"}).summary == "no results"


def test_search_code_records_the_best_score_of_the_run(ctx):
    call(ctx, "search_code", {"query": "kubernetes"})
    assert ctx.state.artifacts["search"] == {"best_score": 0.0, "mode": "bm25_only", "queries": 1,
                                           "embedding_provider": None}
    call(ctx, "search_code", {"query": "parse http header"})
    call(ctx, "search_code", {"query": "kubernetes"})
    assert ctx.state.artifacts["search"] == {"best_score": 1.0, "mode": "bm25_only", "queries": 3,
                                           "embedding_provider": None}


def test_read_skeleton_repo_and_file(ctx):
    outline = call(ctx, "read_skeleton", {})
    assert "shop/db.py (14 lines)" in outline.text
    assert "  class User [4-17]: display_name, to_dict" in outline.text
    detail = call(ctx, "read_skeleton", {"path": "shop/api.py"})
    assert "@logged def get_user(user_id: int) -> dict [15-20]" in detail.text
    assert "import: shop.services (find_user, register_user)" in detail.text
    assert not call(ctx, "read_skeleton", {"path": "nope.py"}).ok


@pytest.mark.parametrize("path", ["", "none", "None", "null", "/"])
def test_read_skeleton_treats_empty_paths_as_the_whole_repo(ctx, path):
    assert call(ctx, "read_skeleton", {"path": path}).summary.startswith("outline of")


def test_get_neighbors(ctx):
    result = call(ctx, "get_neighbors", {"symbol": "find_user"})
    assert "callers:\n  get_user [shop/api.py:15-20]" in result.text
    assert "User.to_dict [shop/models.py:16-17]" in result.text
    by_method = call(ctx, "get_neighbors", {"symbol": "display_name"})
    assert "User.to_dict" in by_method.text
    assert "no function or class named" in call(ctx, "get_neighbors", {"symbol": "nope"}).text


def test_read_file_numbers_lines_and_caps_at_200(ctx, indexed):
    result = call(ctx, "read_file", {"path": "shop/db.py", "start": 8, "end": 10})
    assert result.text.splitlines()[1] == "    8 | def get_user_by_id(user_id: int) -> User | None:"
    (indexed.root / "shop" / "long.py").write_text("\n".join(f"x{i} = {i}" for i in range(500)))
    asyncio.run(indexed.service.index(indexed.repo_id))  # re-index to include long.py
    long = call(ctx, "read_file", {"path": "shop/long.py", "start": 1, "end": 400})
    assert "(showing 1-200 of 500 lines)" in long.text


@pytest.mark.parametrize("path", ["../../etc/passwd", "shop/../../x.py", ".gitignore"])
def test_read_file_refuses_anything_outside_the_index(ctx, path):
    result = call(ctx, "read_file", {"path": path})
    assert not result.ok and "cannot read" in result.text


def test_read_test_output_only_for_current_run(ctx):
    assert call(ctx, "read_test_output", {"run_id": ctx.state.run_id}).summary == "no test results yet"
    ctx.state.artifacts["test_results"].append(
        {"attempt": 1, "passed": 1, "failed": 1, "output": "FAILED test_x - AssertionError"}
    )
    latest = call(ctx, "read_test_output", {"run_id": ctx.state.run_id})
    assert latest.text.startswith("attempt 1: 1 passed, 1 failed\nFAILED test_x")
    other = call(ctx, "read_test_output", {"run_id": "run_aaaaaaaaaaaa"})
    assert not other.ok and "current run" in other.text


# ---------- write_patch ----------

PATCH = """--- a/shop/db.py
+++ b/shop/db.py
@@ -12,3 +12,5 @@ def get_user_by_id(user_id: int) -> User | None:
 
 def save_user(user: User) -> None:
     USERS[user.id] = user
+
+# saved
"""


@pytest.fixture
def worktree_ctx(ctx, indexed, tmp_path) -> ToolContext:
    root = tmp_path / "worktrees"
    worktree = root / "run1"
    subprocess.run(["git", "init", "-q", str(worktree)], check=True)
    (worktree / "shop").mkdir()
    (worktree / "shop" / "db.py").write_bytes((indexed.root / "shop" / "db.py").read_bytes())
    ctx.worktree, ctx.worktrees_root = worktree, root
    return ctx


def test_write_patch_applies_inside_the_worktree(worktree_ctx):
    result = call(worktree_ctx, "write_patch", {"diff": PATCH})
    assert result.ok, result.text
    assert (worktree_ctx.worktree / "shop" / "db.py").read_text().endswith("# saved\n")
    assert worktree_ctx.state.artifacts["patch"] == PATCH
    reread = call(worktree_ctx, "read_file", {"path": "shop/db.py", "start": 16})
    assert "# saved" in reread.text  # read_file reads the worktree in repair runs


def test_write_patch_refuses_test_files(worktree_ctx):
    diff = PATCH.replace("shop/db.py", "tests/test_db.py")
    result = call(worktree_ctx, "write_patch", {"diff": diff})
    assert not result.ok and "test files must never be edited" in result.text


def test_write_patch_refuses_files_outside_the_allowed_set(worktree_ctx):
    worktree_ctx.allowed_files = ["shop/models.py"]
    result = call(worktree_ctx, "write_patch", {"diff": PATCH})
    assert not result.ok and "outside the Architect's set" in result.text
    assert worktree_ctx.state.artifacts["patch_rejections"][-1]["policy"] is True


def test_write_patch_refuses_patches_over_the_size_limit(worktree_ctx):
    big = PATCH.replace("+# saved\n", "".join(f"+# line {i}\n" for i in range(80)))
    big = big.replace("@@ -12,3 +12,5 @@", "@@ -12,3 +12,84 @@")
    result = call(worktree_ctx, "write_patch", {"diff": big})
    assert not result.ok and "patch too large: 81 changed lines" in result.text


def test_write_patch_rejects_a_diff_that_does_not_apply(worktree_ctx):
    result = call(worktree_ctx, "write_patch", {"diff": PATCH.replace("USERS[user.id]", "NOPE[")})
    assert not result.ok and "does not apply" in result.text
    assert worktree_ctx.state.artifacts["patch_rejections"][-1]["policy"] is False
    assert not (worktree_ctx.worktree / "shop" / "db.py").read_text().endswith("# saved\n")


FIX = """--- a/shop/db.py
+++ b/shop/db.py
@@ -9,2 +9,2 @@ def get_user_by_id(user_id: int) -> User | None:
     \"\"\"Look up one user.\"\"\"
-    return USERS.get(user_id)
+    return USERS.get(int(user_id))
"""


def _fixed(worktree_ctx) -> bool:
    return "USERS.get(int(user_id))" in (worktree_ctx.worktree / "shop" / "db.py").read_text()


def test_write_patch_accepts_paths_without_a_b_prefixes(worktree_ctx):
    # "--- shop/db.py" used to fail: git's -p1 stripped "shop/" and looked for "db.py".
    bare = FIX.replace("a/shop/", "shop/").replace("b/shop/", "shop/")
    result = call(worktree_ctx, "write_patch", {"diff": bare})
    assert result.ok, result.text
    assert _fixed(worktree_ctx)
    assert worktree_ctx.state.artifacts["patch"] == FIX  # stored with normal headers


def test_write_patch_accepts_wrong_hunk_line_numbers_and_counts(worktree_ctx):
    wrong = FIX.replace("@@ -9,2 +9,2 @@", "@@ -24,4 +24,7 @@")
    result = call(worktree_ctx, "write_patch", {"diff": wrong})
    assert result.ok, result.text
    assert _fixed(worktree_ctx)


def test_write_patch_matches_old_lines_by_content_when_git_cannot(worktree_ctx):
    # Trailing spaces on a context line and an empty context line without its leading space.
    sloppy = """--- a/shop/db.py
+++ b/shop/db.py
@@ -1,1 +1,1 @@
     \"\"\"Look up one user.\"\"\"
-    return USERS.get(user_id)
+    return USERS.get(int(user_id))

"""
    result = call(worktree_ctx, "write_patch", {"diff": sloppy})
    assert result.ok, result.text
    assert _fixed(worktree_ctx)


def test_write_patch_by_content_refuses_ambiguous_old_lines(worktree_ctx):
    before = (worktree_ctx.worktree / "shop" / "db.py").read_text()
    ambiguous = """--- a/shop/db.py
+++ b/shop/db.py
@@ -1,1 +1,1 @@
-
+# changed
"""
    result = call(worktree_ctx, "write_patch", {"diff": ambiguous})
    assert not result.ok and "does not apply" in result.text
    assert (worktree_ctx.worktree / "shop" / "db.py").read_text() == before


def test_write_patch_needs_a_worktree_inside_the_root(ctx, worktree_ctx, tmp_path):
    worktree_ctx.worktrees_root = tmp_path / "somewhere_else"
    assert "outside the repair worktrees" in call(worktree_ctx, "write_patch", {"diff": PATCH}).text
    worktree_ctx.worktree = None
    assert "no worktree" in call(worktree_ctx, "write_patch", {"diff": PATCH}).text


@pytest.mark.parametrize(
    ("path", "is_test"),
    [("tests/test_api.py", True), ("shop/test_utils.py", True), ("pkg/utils_test.py", True),
     ("conftest.py", True), ("test/helpers.py", True), ("shop/testing.py", False),
     ("shop/contest.py", False), ("shop/db.py", False)],
)
def test_is_test_path(path, is_test):
    assert is_test_path(path) is is_test


def test_patched_paths():
    assert patched_paths(PATCH) == ["shop/db.py"]
    new_file = "--- /dev/null\n+++ b/shop/new.py\n@@ -0,0 +1 @@\n+x = 1\n"
    assert patched_paths(new_file) == ["shop/new.py"]
