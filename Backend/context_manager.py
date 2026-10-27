"""Budgeted retrieval from repository files and the skeleton index."""

import re
from pathlib import Path

from skeleton_index import SKIP_DIRS, build_index

# Directories ignored by both retrieval and the skeleton index.
SKIP_DIRS = {".git", ".venv", "venv", "node_modules", "__pycache__", ".pytest_cache",
             ".mypy_cache", "dist", "build"}
TEXT_SUFFIXES = {".py", ".md", ".html", ".css", ".js", ".ts", ".json", ".toml"}
# Hard cap on bytes read from any single file so a huge file cannot eat the budget.
MAX_FILE_BYTES = 256_000
# Approximate characters per token used for the budget estimate.
CHARS_PER_TOKEN = 4


def _terms(text: str) -> set[str]:
    return {word.lower() for word in re.findall(r"[A-Za-z_][A-Za-z_0-9]{2,}", text)}


def _iter_text_files(root: Path):
    for path in root.rglob("*"):
        if not path.is_file() or any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        yield path


def retrieve(root: Path, query: str, token_budget: int = 3000) -> str:
    """Return relevant source excerpts with file:line citations.

    Retrieval uses local lexical overlap as a dependency-free baseline. The
    budget is conservatively estimated at four characters per token and is
    enforced on the returned text, so callers never receive more than requested.
    """
    terms = _terms(query)
    if not terms:
        return "No matching repository context found."

    index = build_index(root)
    # Map dotted call names to their attribute part so "read_text" from
    # "path.read_text()" can match a single-word query term.
    symbol_files: dict[str, set[str]] = {}
    for item in index:
        name = item["name"].lower()
        symbol_files.setdefault(name, set()).add(item["file"])
        if "." in name:
            attr = name.rsplit(".", 1)[-1]
            symbol_files.setdefault(attr, set()).add(item["file"])

    ranked = []
    for path in _iter_text_files(root):
        try:
            if path.stat().st_size > MAX_FILE_BYTES:
                continue
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        rel = path.relative_to(root).as_posix()
        lowertext = text.lower()
        # Token-level matching on word boundaries, not raw substring.
        hits = sum(1 for term in terms if re.search(rf"\b{re.escape(term)}\b", lowertext))
        symbol_hits = sum(2 for term in terms if rel in symbol_files.get(term, ()))
        # Source code matches are worth more than prose/docs for code questions.
        weight = 2 if path.suffix == ".py" else 1
        if hits or symbol_hits:
            ranked.append((weight * hits + symbol_hits, rel, text))
    ranked.sort(key=lambda item: (-item[0], item[1]))

    remaining = max(1, int(token_budget)) * CHARS_PER_TOKEN
    excerpts = []
    for _, rel, text in ranked:
        if remaining <= 0:
            break
        lines = text.splitlines()
        # Include matching lines with nearby context, keeping citations stable.
        selected = set()
        for i, line in enumerate(lines):
            if terms & _terms(line):
                selected.update(range(max(0, i - 2), min(len(lines), i + 3)))
        excerpt = "\n".join(f"[{rel}:{i + 1}] {lines[i]}" for i in sorted(selected))
        if not excerpt:
            excerpt = "\n".join(f"[{rel}:{i + 1}] {line}" for i, line in enumerate(lines[:30]))
        # Respect the remaining budget before appending, cutting on a line
        # boundary so citations stay intact and the text is never truncated
        # mid-word or mid-citation.
        if len(excerpt) > remaining:
            kept = []
            used = 0
            for line in excerpt.split("\n"):
                cost = len(line) + 1
                if used + cost > remaining:
                    break
                kept.append(line)
                used += cost
            excerpt = "\n".join(kept)
        if excerpt:
            excerpts.append(excerpt)
            remaining -= len(excerpt) + 2  # account for the "\n\n" join separator
    return "\n\n".join(excerpts) or "No matching repository context found."
