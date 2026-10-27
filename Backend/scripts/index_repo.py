"""Index a local repo from the command line and print timings.

Usage (from Backend/):  python scripts/index_repo.py <path-to-repo>

Uses the same settings and data folder as the server, so the server can serve
the result afterwards. Prints the time per stage and the number of embedding
API calls (running it twice shows the cache at work: 0 calls the second time).
"""

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import load_settings  # noqa: E402
from app.indexing.intake import IndexingError  # noqa: E402
from app.indexing.pipeline import Indexer  # noqa: E402
from app.indexing.service import IndexService  # noqa: E402
from app.llm import LLMRouter  # noqa: E402


async def main(path: str) -> int:
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    settings = load_settings()
    router = LLMRouter(settings) if settings.file_summaries else None
    service = IndexService(settings, router)
    try:
        meta = service.add_repo(None, path)
    except Exception as exc:  # ApiError for a bad path
        print(f"Cannot index {path}: {getattr(exc, 'message', exc)}")
        return 1

    print(f"Indexing {meta.root} as {meta.repo_id} ...", flush=True)
    try:
        report = await Indexer(settings, router, service.embedder).run(meta)
    except (IndexingError, OSError) as exc:
        print(f"Indexing failed: {exc}")
        return 1

    print("\nStage timings:")
    for stage, seconds in report.timings.items():
        print(f"  {stage:<10} {seconds:8.3f} s")
    print(f"  {'total':<10} {sum(report.timings.values()):8.3f} s\n")
    print(f"Files:            {report.files_total} ({report.files_parsed} parsed, "
          f"{report.files_reused} unchanged)")
    print(f"Chunks:           {report.chunks_total} ({report.chunks_embedded} with vectors)")
    print(f"Search mode:      {report.search_mode}")
    print(f"Embedding model:  {settings.gemini_embedding_model}")
    print(f"Embedding calls:  {report.embedding_api_calls} API requests, "
          f"{report.embedding_cache_hits} chunks from cache")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(asyncio.run(main(sys.argv[1])))
