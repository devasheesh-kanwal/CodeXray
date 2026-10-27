"""Budgeted retrieval from repository files and the skeleton index."""

import re
from pathlib import Path

from skeleton_index import build_index


def _terms(text: str) -> set[str]:
    return {word.lower() for word in re.findall(r"[A-Za-z_][A-Za-z_0-9]{2,}", text)}


def retrieve(root: Path, query: str, token_budget: int = 3000) -> str:
    """Return relevant source excerpts with file:line citations.

    Retrieval uses local lexical overlap as a dependency-free baseline. The budget
    is conservatively estimated at four characters per token.
    """
    terms = _terms(query)
    ranked = []
    index = build_index(root)
    for path in root.rglob("*"):
        if not path.is_file() or any(part in {".git", ".venv", "venv", "node_modules"} for part in path.parts):
            continue
        try:
            if path.suffix.lower() not in {".py", ".md", ".html", ".css", ".js", ".ts", ".json", ".toml"}:
                continue
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        rel = path.relative_to(root).as_posix()
        hits = sum(1 for term in terms if term in text.lower())
        symbol_hits = sum(2 for item in index if item["file"] == rel and item["name"].lower() in terms)
        if hits or symbol_hits:
            ranked.append((hits + symbol_hits, rel, text))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    remaining = max(1, token_budget) * 4
    excerpts = []
    for _, rel, text in ranked:
        lines = text.splitlines()
        # Include matching lines with nearby context, keeping citations stable.
        selected = set()
        for i, line in enumerate(lines):
            if terms & _terms(line):
                selected.update(range(max(0, i - 2), min(len(lines), i + 3)))
        excerpt = "\n".join(f"[{rel}:{i + 1}] {lines[i]}" for i in sorted(selected))
        if not excerpt:
            excerpt = "\n".join(f"[{rel}:{i + 1}] {line}" for i, line in enumerate(lines[:30]))
        excerpt = excerpt[:remaining]
        if excerpt:
            excerpts.append(excerpt)
            remaining -= len(excerpt)
        if remaining <= 0:
            break
    return "\n\n".join(excerpts) or "No matching repository context found."
