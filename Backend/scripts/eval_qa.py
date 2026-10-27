"""Run the Q&A eval set against an indexed repo with the real LLMs and print the results.

Usage (from Backend/):  python scripts/eval_qa.py <repo_id> [--file tests/qa_eval.yaml]

For each question: pass/fail (every must_cite file is among the verified
citations, and not_found is as expected). Then: citation accuracy (verified
markers / all markers), average Architect steps, average LLM calls and average
latency. Entries that still contain "TODO" are skipped.
"""

import argparse
import asyncio
import logging
import sys
import time
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agents.state import RunState  # noqa: E402
from app.config import load_settings  # noqa: E402
from app.errors import ApiError  # noqa: E402
from app.indexing.service import IndexService  # noqa: E402
from app.llm import LLMRouter  # noqa: E402
from app.qa.service import QaService  # noqa: E402

DEFAULT_FILE = Path(__file__).resolve().parent.parent / "tests" / "qa_eval.yaml"


def architect_steps(state: RunState) -> int:
    """LLM steps the Architect used (from its agent_output event)."""
    outputs = [e for e in state.events if e.agent == "architect" and e.kind == "agent_output"]
    if not outputs:
        return 0
    return outputs[-1].step or 0


async def evaluate(repo_id: str, path: Path) -> int:
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    settings = load_settings()
    router = LLMRouter(settings)
    index = IndexService(settings, router)
    qa = QaService(settings, index, router)
    try:
        qa.check_ready(repo_id)
    except ApiError as exc:
        print(f"Cannot evaluate {repo_id}: {exc.message}")
        return 1

    entries = yaml.safe_load(path.read_text(encoding="utf-8"))["questions"]
    todo = [e["id"] for e in entries if "TODO" in str(e)]
    entries = [e for e in entries if e["id"] not in todo]
    if todo:
        print(f"Skipping {len(todo)} entries that still contain TODO: {', '.join(todo)}")
    if not entries:
        print(f"Nothing to run: fill in the TODOs in {path}")
        return 1

    passed, markers, verified, steps, calls, seconds = 0, 0, 0, [], [], []
    for entry in entries:
        started = time.monotonic()
        state = await qa.run(repo_id, entry["question"])
        seconds.append(time.monotonic() - started)
        steps.append(architect_steps(state))
        calls.append(state.usage.llm_calls)
        try:
            answer = qa.response(state)
        except ApiError as exc:
            print(f"FAIL {entry['id']}: run {state.run_id} failed ({exc.code})")
            continue

        check = state.artifacts.get("check") or {}
        markers += check.get("markers_total", 0)
        verified += check.get("markers_total", 0) - check.get("markers_dropped", 0)
        cited = {c.file for c in answer.citations}
        missing = [f for f in entry.get("must_cite", []) if f not in cited]
        expect_not_found = entry.get("expect_not_found", False)
        ok = answer.not_found == expect_not_found and not missing
        passed += ok
        detail = f"missing {', '.join(missing)}" if missing else f"not_found={answer.not_found}"
        print(f"{'PASS' if ok else 'FAIL'} {entry['id']}: {detail} | cited {sorted(cited) or '-'} "
              f"| confidence {answer.confidence} | run {state.run_id}")

    count = len(entries)
    print()
    print(f"Passed:                 {passed}/{count}")
    print(f"Citation accuracy:      {verified}/{markers} markers verified"
          + (f" ({verified / markers:.0%})" if markers else ""))
    print(f"Avg Architect steps:    {sum(steps) / count:.1f}")
    print(f"Avg LLM calls:          {sum(calls) / count:.1f}")
    print(f"Avg latency:            {sum(seconds) / count:.1f} s")
    return 0 if passed == count else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("repo_id")
    parser.add_argument("--file", type=Path, default=DEFAULT_FILE)
    args = parser.parse_args()
    return asyncio.run(evaluate(args.repo_id, args.file))


if __name__ == "__main__":
    sys.exit(main())
