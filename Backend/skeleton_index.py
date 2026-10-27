"""Build a lightweight Python symbol and call index for repository context."""

import ast
from pathlib import Path

# Directories ignored by both the skeleton index and retrieval.
SKIP_DIRS = {".git", ".venv", "venv", "node_modules", "__pycache__", ".pytest_cache",
             ".mypy_cache", "dist", "build"}


def build_index(root: Path) -> list[dict]:
    entries = []
    for path in root.rglob("*.py"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        try:
            source = path.read_text(encoding="utf-8")
            tree = ast.parse(source)
        except (OSError, UnicodeError, SyntaxError):
            continue
        relative = path.relative_to(root).as_posix()
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                entries.append({"file": relative, "line": node.lineno,
                                "kind": type(node).__name__, "name": node.name,
                                "summary": ast.get_docstring(node) or ""})
            elif isinstance(node, ast.Call):
                name = node.func.id if isinstance(node.func, ast.Name) else (
                    f"{node.func.value.id}.{node.func.attr}"
                    if isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name)
                    else "")
                if name:
                    entries.append({"file": relative, "line": node.lineno,
                                    "kind": "call", "name": name, "summary": ""})
    return sorted(entries, key=lambda item: (item["file"], item["line"]))
