"""Repair test kit: the fixture repo as a real git repo, indexed (BM25 only),
a scripted fake LLM per lane, and the subprocess sandbox (no Docker needed)."""

import asyncio
import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pytest

from app.indexing.pipeline import Indexer
from app.indexing.service import IndexService
from app.llm import LLMRouter
from app.llm.routes import LaneEntry
from app.repair.sandbox import Sandbox
from app.repair.service import RepairService
from tests.conftest import make_settings
from tests.llm.fakes import FakeProviders, ok

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "repair_repo"
ISSUE = "top_sellers(sales, 2) returns only one item"
TARGET = "tests/test_stock.py::test_top_sellers_returns_n_items"

FIX = """--- a/inventory/stock.py
+++ b/inventory/stock.py
@@ -4,7 +4,7 @@
 def top_sellers(sales: dict[str, int], n: int) -> list[str]:
     \"\"\"The n best-selling items, best first.\"\"\"
     ranked = sorted(sales, key=lambda item: sales[item], reverse=True)
-    return ranked[: n - 1]
+    return ranked[:n]
 
 
 def total_units(sales: dict[str, int]) -> int:
"""

# Fixes the target test but breaks test_total_units.
REGRESSION = """--- a/inventory/stock.py
+++ b/inventory/stock.py
@@ -4,9 +4,9 @@
 def top_sellers(sales: dict[str, int], n: int) -> list[str]:
     \"\"\"The n best-selling items, best first.\"\"\"
     ranked = sorted(sales, key=lambda item: sales[item], reverse=True)
-    return ranked[: n - 1]
+    return ranked[:n]


 def total_units(sales: dict[str, int]) -> int:
     \"\"\"All units sold.\"\"\"
-    return sum(sales.values())
+    return sum(sales.values()) - 1
"""

EDITS_TEST = """--- a/tests/test_stock.py
+++ b/tests/test_stock.py
@@ -6,5 +6,5 @@
 def test_top_sellers_returns_n_items():
-    assert top_sellers(SALES, 2) == ["pear", "apple"]
+    assert top_sellers(SALES, 2) == ["pear"]
 
 
 def test_total_units():
"""

# Default lanes: one fake model per lane, so each model's script belongs to known agents.
LANES = {
    "long_context": [LaneEntry(provider="groq", model="arch-m", max_context=100_000)],
    "heavy_code": [LaneEntry(provider="groq", model="code-m", max_context=100_000)],
    "reviewer": [LaneEntry(provider="gemini", model="review-m", max_context=100_000)],
    "fast_small": [LaneEntry(provider="groq", model="small-m", max_context=100_000)],
}


def final(data: dict):
    return ok(json.dumps({"final": data}))


def tool_call(name: str, args: dict):
    return ok("", tool_calls=[{"id": "call_1", "type": "function",
                               "function": {"name": name, "arguments": json.dumps(args)}}])


def architect_picks(*files: str):
    return final({"files": [{"file": f, "reason": "holds the failing code"} for f in files],
                  "summary": "the bug is in inventory/stock.py"})


def diagnosis(root_cause: str, plan: str = "return ranked[:n]"):
    return final({"root_cause": root_cause, "file": "inventory/stock.py", "start_line": 4,
                  "end_line": 7, "evidence": ["return ranked[: n - 1]"], "fix_plan": plan})


def patch(diff: str, attempt: int = 1):
    """The Repair agent's two replies: write_patch, then its final answer."""
    return [tool_call("write_patch", {"diff": diff}),
            final({"summary": f"attempt {attempt}: fixed the slice", "files_changed": ["inventory/stock.py"]})]


def review(verdict: str = "approve", notes: str = "Looks good."):
    return final({"verdict": verdict, "risk": "low", "notes": notes, "concerns": []})


def note(text: str):
    return ok(json.dumps({"failure_note": text}))


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout


@dataclass
class Kit:
    service: RepairService
    fake: FakeProviders
    repo: Path
    repo_id: str
    data_dir: Path

    def run(self, issue: str = ISSUE, test_command: str | None = "python -m pytest -q"):
        """Start a run and wait for it to stop (AWAITING_APPROVAL or a final state)."""
        async def go():
            state = self.service.start(self.repo_id, issue, test_command)
            return await self.service.wait(state.run_id)
        return asyncio.run(go())

    def decide(self, run_id: str, approve: bool):
        return asyncio.run(self.service.decide(run_id, approve))

    def calls_by(self, prompt_title: str) -> list[dict]:
        """Request bodies whose system prompt starts with '# <prompt_title>'."""
        return [c.body for c in self.fake.calls
                if c.body["messages"][0]["content"].startswith(f"# {prompt_title}")]

    def models_for(self, prompt_title: str) -> list[str]:
        return [c.model for c in self.fake.calls
                if c.body["messages"][0]["content"].startswith(f"# {prompt_title}")]

    def worktrees(self) -> list[str]:
        return [line for line in git(self.repo, "worktree", "list", "--porcelain").splitlines()
                if line.startswith("worktree ")]

    def branches(self) -> list[str]:
        return git(self.repo, "branch", "--format=%(refname:short)").split()


def make_kit(tmp_path: Path, lanes=None) -> Kit:
    repo = tmp_path / "shop_repo"
    shutil.copytree(FIXTURE, repo)
    git(repo, "init", "-q", "-b", "main")
    git(repo, "add", "-A")
    git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "initial")

    settings = make_settings(tmp_path, mock_mode=False, embeddings=False, data_dir=tmp_path / "data",
                             groq_api_keys="gsk_test1111", gemini_api_keys="gem_test2222")
    index = IndexService(settings)
    meta = index.add_repo(None, str(repo))
    asyncio.run(Indexer(settings, None, index.embedder).run(meta))

    fake = FakeProviders()
    router = LLMRouter(settings, lanes=lanes or LANES, transport=fake.transport())
    service = RepairService(settings, index, router, Sandbox(timeout_s=60, use_docker=False))
    return Kit(service, fake, repo, meta.repo_id, settings.data_path)


@pytest.fixture
def kit(tmp_path) -> Kit:
    return make_kit(tmp_path)
