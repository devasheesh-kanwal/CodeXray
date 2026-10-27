"""Send one tiny real request to every lane entry and print which models work.

Usage (from Backend/):  python scripts/check_providers.py

Uses the API keys in .env. One request per distinct provider/model, with no
cache and no fallback. All calls go through app/llm (the only code allowed to
call providers).
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import load_settings  # noqa: E402
from app.llm import LLMRouter  # noqa: E402
from app.llm.routes import LaneEntry  # noqa: E402


async def check(router: LLMRouter, entry: LaneEntry) -> tuple[str, str, str]:
    """(result, latency, detail) for one entry."""
    if not router.keys[entry.provider].configured:
        return "SKIP", "-", "no API keys in .env"
    if (entry.provider, entry.model) in router.state.missing_models:
        return "FAIL", "-", "not in the provider's model list"
    ok, latency_ms, detail = await router.probe(entry)
    return ("OK" if ok else "FAIL"), f"{latency_ms} ms", detail


def print_table(rows: list[tuple[str, ...]]) -> None:
    header = ("lane", "provider/model", "result", "latency", "detail")
    widths = [max(len(r[i]) for r in [header, *rows]) for i in range(4)]
    for row in [header, *rows]:
        cells = [cell.ljust(widths[i]) for i, cell in enumerate(row[:4])]
        print("  ".join(cells), row[4])


async def main() -> int:
    settings = load_settings()
    if settings.demo_mode:
        print("DEMO_MODE=true: refusing to call providers. Set DEMO_MODE=false to check.")
        return 1

    router = LLMRouter(settings)
    print("Checking configured model IDs against each provider's /models list...", flush=True)
    for warning in await router.check_models():
        print(f"  warning: {warning}")

    entries = {e.label: e for lane in router.lanes.values() for e in lane}
    print(f"Sending one tiny request to each of {len(entries)} models...\n", flush=True)
    results = dict(
        zip(entries, await asyncio.gather(*(check(router, e) for e in entries.values())))
    )

    rows = [
        (lane, entry.label, *results[entry.label])
        for lane, lane_entries in router.lanes.items()
        for entry in lane_entries
    ]
    print_table(rows)
    failing = sum(1 for result in results.values() if result[0] != "OK")
    print(f"\n{len(results) - failing} of {len(results)} models working.")
    return 0 if failing == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
