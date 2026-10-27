"""Context manager: turn questions into a citable, budget-limited code context.

search (top_k) -> add 1-hop graph neighbors -> rank (search hits first, then
neighbors) -> fit into the token budget. Long chunks keep their first and last
lines with a marked cut. Every snippet is labelled [file:start-end].
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

import networkx as nx

from app.indexing.chunker import Chunk
from app.indexing.graph import neighbors
from app.indexing.search import RepoSearch

DEFAULT_TOP_K = 12
LONG_CHUNK_LINES = 60
KEEP_HEAD_LINES = 20  # includes decorators and the signature
KEEP_TAIL_LINES = 10


@dataclass
class Snippet:
    file: str
    symbol: str
    start_line: int
    end_line: int
    label: str  # '[file:start-end]', what answers cite
    text: str
    source: Literal["search", "neighbor", "selected"]  # selected = chosen by an agent
    truncated: bool

    def render(self) -> str:
        return f"{self.label}\n{self.text}"


@dataclass
class Context:
    snippets: list[Snippet]
    best_score: float  # 0..1 from search; low means "probably not in this repo"
    tokens_used: int


def estimate_tokens(text: str) -> int:
    return len(text) // 4 + 1


async def build_context(
    search: RepoSearch,
    graph: nx.DiGraph,
    queries: list[str],
    token_budget: int,
    top_k: int = DEFAULT_TOP_K,
) -> Context:
    ranked, best_score = await _search_all(search, queries, top_k)
    candidates = [(chunk, "search") for chunk in ranked]
    candidates += [(chunk, "neighbor") for chunk in _neighbor_chunks(search, graph, ranked)]

    snippets: list[Snippet] = []
    used = 0
    for chunk, source in candidates:
        snippet = make_snippet(chunk, source)
        cost = estimate_tokens(snippet.render())
        if used + cost <= token_budget:  # skip what doesn't fit, try smaller ones
            snippets.append(snippet)
            used += cost
    return Context(snippets=snippets, best_score=best_score, tokens_used=used)


async def _search_all(search: RepoSearch, queries: list[str], top_k: int) -> tuple[list[Chunk], float]:
    """Best score per chunk over all queries, highest first."""
    scores: dict[str, float] = {}
    best = 0.0
    for query in queries:
        result = await search.search(query, top_k)
        best = max(best, result.best_score)
        for hit in result.hits:
            scores[hit.chunk_id] = max(scores.get(hit.chunk_id, 0.0), hit.score)
    ranked = sorted(scores, key=lambda chunk_id: scores[chunk_id], reverse=True)[:top_k]
    return [search.chunks[chunk_id] for chunk_id in ranked], best


def _neighbor_chunks(search: RepoSearch, graph: nx.DiGraph, hits: list[Chunk]) -> list[Chunk]:
    """Callers and callees (1 hop) of the hits, in hit order, without repeats."""
    by_node = {c.node_id: c for c in search.chunks.values() if c.kind != "module"}
    seen = {c.id for c in hits}
    found: list[Chunk] = []
    for hit in hits:
        near = neighbors(graph, hit.node_id, hops=1)
        for node in near["callers"] + near["callees"]:
            chunk = by_node.get(node)
            if chunk and chunk.id not in seen:
                seen.add(chunk.id)
                found.append(chunk)
    return found


def make_snippet(chunk: Chunk, source: Literal["search", "neighbor"]) -> Snippet:
    lines = chunk.text.splitlines()[1:]  # drop the '# file: ... | symbol: ...' line
    return _snippet(chunk.file, chunk.symbol, chunk.start_line, chunk.end_line, lines, source)


def snippets_for_ranges(
    read_lines: Callable[[str], list[str]],
    ranges: list[tuple[str, int, int]],
    token_budget: int,
) -> list[Snippet]:
    """Snippets for chosen (file, start, end) ranges, in order, within the budget.

    read_lines(file) returns the file's lines, or [] for a file that is not
    indexed (that range is skipped). Ranges are clamped to the file length and
    overlapping ranges in one file are merged.
    """
    snippets: list[Snippet] = []
    used = 0
    for file, start, end in _merge_ranges(read_lines, ranges):
        lines = read_lines(file)
        snippet = _snippet(file, "", start, end, lines[start - 1 : end], "selected")
        cost = estimate_tokens(snippet.render())
        if used + cost <= token_budget:
            snippets.append(snippet)
            used += cost
    return snippets


def _merge_ranges(read_lines, ranges: list[tuple[str, int, int]]) -> list[tuple[str, int, int]]:
    """Valid, clamped ranges; a range overlapping an earlier one in the same file joins it."""
    merged: list[list] = []
    for file, start, end in ranges:
        line_count = len(read_lines(file))
        start, end = max(start, 1), min(end, line_count)
        if start > end:
            continue  # unknown file, or a range past the end of the file
        for item in merged:
            if item[0] == file and start <= item[2] and end >= item[1]:
                item[1], item[2] = min(item[1], start), max(item[2], end)
                break
        else:
            merged.append([file, start, end])
    return [tuple(item) for item in merged]


def _snippet(file: str, symbol: str, start: int, end: int, lines: list[str], source) -> Snippet:
    """Label the lines; long ones keep their head and tail with a marked cut."""
    truncated = len(lines) > LONG_CHUNK_LINES
    if truncated:
        lines = [
            *lines[:KEEP_HEAD_LINES],
            f"    # ... lines {start + KEEP_HEAD_LINES}-{end - KEEP_TAIL_LINES} cut ...",
            *lines[-KEEP_TAIL_LINES:],
        ]
    return Snippet(
        file=file,
        symbol=symbol,
        start_line=start,
        end_line=end,
        label=f"[{file}:{start}-{end}]",
        text="\n".join(lines),
        source=source,
        truncated=truncated,
    )
