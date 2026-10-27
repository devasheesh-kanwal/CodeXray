"""Fill the on-disk caches for the demo, so DEMO_MODE=true can answer offline.

Usage (from Backend/):
    python scripts/demo_prepare.py           # index the demo repo, ask and review everything
    python scripts/demo_prepare.py --check   # DEMO_MODE=true: replay one question and one review

The demo repo is DEMO_REPO_PATH (from .env), else tests/fixtures/sample_repo
(the repo tests/qa_eval.yaml is written for). Everything goes through the real
HTTP endpoints, run in-process with MOCK_MODE off, and uses the same data folder
as the server, so the server serves the cached answers afterwards.

Prepare asks the fixed demo questions plus every question in tests/qa_eval.yaml,
and reviews every file in demo/diffs/. It prints each call's time and whether
the answer was cached. --check counts real API calls (LLM and embeddings): a
working offline fallback makes zero.
"""

import argparse
import sys
import time
from pathlib import Path

import yaml

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app

DEMO_QUESTIONS = [
    "How does user login work?",
    "Where is user data stored?",
    "Which file handles payments?",
]
EVAL_FILE = BACKEND / "tests" / "qa_eval.yaml"
DIFFS_DIR = BACKEND / "demo" / "diffs"
DEFAULT_REPO = BACKEND / "tests" / "fixtures" / "sample_repo"
INDEX_TIMEOUT_S = 600


def demo_questions() -> list[str]:
    """The fixed questions, then the eval set's (skipping TODO entries), without duplicates."""
    questions = list(DEMO_QUESTIONS)
    data = yaml.safe_load(EVAL_FILE.read_text(encoding="utf-8")) or {}
    for item in data.get("questions", []):
        question = str(item.get("question", "")).strip()
        if question and "TODO" not in question.upper() and question not in questions:
            questions.append(question)
    return questions


def diff_files() -> list[Path]:
    return sorted(p for p in DIFFS_DIR.glob("*") if p.is_file()) if DIFFS_DIR.is_dir() else []


def make_client(demo_mode: bool) -> tuple[TestClient, object]:
    settings = load_settings().model_copy(update={"mock_mode": False, "demo_mode": demo_mode})
    app = create_app(settings)
    return TestClient(app), app


def api_calls(app) -> tuple[int, int]:
    """(LLM requests that were not cache hits, embedding API requests) so far."""
    llm = sum(1 for call in app.state.llm_router.state.calls if not call.cached)
    return llm, app.state.index_service.embedder.api_calls


def index_repo(client: TestClient, path: Path) -> str:
    started = time.monotonic()
    resp = client.post("/api/repos", json={"local_path": str(path)})
    if resp.status_code != 202:
        raise SystemExit(f"Cannot index {path}: {resp.json()['error']['message']}")
    repo_id = resp.json()["repo_id"]
    while True:
        status = client.get(f"/api/repos/{repo_id}/status").json()
        if status["stage"] in ("ready", "failed"):
            break
        if time.monotonic() - started > INDEX_TIMEOUT_S:
            raise SystemExit(f"Indexing {repo_id} did not finish in {INDEX_TIMEOUT_S} s")
        time.sleep(1)
    if status["stage"] == "failed":
        raise SystemExit(f"Indexing failed: {status['error']}")
    print(f"Indexed {path} as {repo_id}: {status['files_total']} files, {status['chunks_total']} chunks, "
          f"search {status['search_mode']} ({time.monotonic() - started:.1f} s)")
    return repo_id


def ask(client: TestClient, repo_id: str, question: str) -> bool:
    started = time.monotonic()
    resp = client.post(f"/api/repos/{repo_id}/ask", json={"question": question})
    seconds = time.monotonic() - started
    if resp.status_code != 200:
        print(f"  FAIL  {seconds:6.1f} s  {question}  -> {resp.status_code} {resp.json()['error']['message']}")
        return False
    body = resp.json()
    result = "not found" if body["not_found"] else f"{len(body['citations'])} citations"
    source = "cached" if body["cached"] else f"{body['provider']}/{body['model']}"
    print(f"  ok    {seconds:6.1f} s  {question}  -> {result}, {source}")
    return True


def review(client: TestClient, repo_id: str, diff: Path) -> bool:
    started = time.monotonic()
    resp = client.post(f"/api/repos/{repo_id}/review", json={"diff_text": diff.read_text(encoding="utf-8")})
    seconds = time.monotonic() - started
    if resp.status_code != 200:
        print(f"  FAIL  {seconds:6.1f} s  {diff.name}  -> {resp.status_code} {resp.json()['error']['message']}")
        return False
    print(f"  ok    {seconds:6.1f} s  {diff.name}  -> {len(resp.json()['findings'])} findings")
    return True


def prepare(repo_path: Path) -> int:
    with make_client(demo_mode=False)[0] as client:
        repo_id = index_repo(client, repo_path)
        questions = demo_questions()
        print(f"\nQ&A ({len(questions)} questions):")
        asked = sum(ask(client, repo_id, q) for q in questions)
        diffs = diff_files()
        print(f"\nPR review ({len(diffs)} diffs in {DIFFS_DIR}):")
        if not diffs:
            print("  (no diff files; nothing to review)")
        reviewed = sum(review(client, repo_id, d) for d in diffs)
    print(f"\nCached: {asked}/{len(questions)} answers, {reviewed}/{len(diffs)} reviews.")
    return 0 if asked == len(questions) and reviewed == len(diffs) else 1


def check(repo_path: Path) -> int:
    """DEMO_MODE=true: one question and one review must answer with zero API calls."""
    client, app = make_client(demo_mode=True)
    with client:
        repo_id = client.post("/api/repos", json={"local_path": str(repo_path)}).json().get("repo_id")
        while client.get(f"/api/repos/{repo_id}/status").json()["stage"] not in ("ready", "failed"):
            time.sleep(0.5)
        before = api_calls(app)
        print("DEMO_MODE=true replay:")
        ok_ask = ask(client, repo_id, DEMO_QUESTIONS[0])
        diffs = diff_files()
        ok_review = review(client, repo_id, diffs[0]) if diffs else False
        if not diffs:
            print(f"  FAIL  no diff in {DIFFS_DIR} to review")
        llm, embed = (a - b for a, b in zip(api_calls(app), before, strict=True))
    print(f"\nReal API calls during the replay: {llm} LLM, {embed} embedding.")
    return 0 if ok_ask and ok_review and llm == 0 and embed == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="replay offline with DEMO_MODE=true")
    args = parser.parse_args()
    repo_path = (load_settings().demo_repo_path or DEFAULT_REPO).resolve()
    return check(repo_path) if args.check else prepare(repo_path)


if __name__ == "__main__":
    raise SystemExit(main())
