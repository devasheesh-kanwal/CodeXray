"""Find the source files of a repo, applying the skip rules."""

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path

import pathspec

SKIP_DIRS = {".git", "venv", ".venv", "node_modules", "__pycache__", "build", "dist"}
MAX_FILE_BYTES = 200 * 1024
SOURCE_SUFFIXES = {".py"}  # Python repos only for now
BINARY_SNIFF_BYTES = 8192


@dataclass
class RepoFile:
    path: str  # repo-relative, '/' separators
    abs_path: Path
    sha256: str
    size: int


def is_env_file(name: str) -> bool:
    return name == ".env" or name.startswith(".env.")


def is_binary(data: bytes) -> bool:
    return b"\x00" in data[:BINARY_SNIFF_BYTES]


def list_source_files(root: Path) -> list[RepoFile]:
    """Every indexable source file under root, sorted by path."""
    root = root.resolve()
    ignore_specs: list[tuple[str, pathspec.GitIgnoreSpec]] = []
    found: list[RepoFile] = []

    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = Path(dirpath).relative_to(root).as_posix()
        rel_dir = "" if rel_dir == "." else rel_dir
        if ".gitignore" in filenames:
            lines = (Path(dirpath) / ".gitignore").read_text(
                encoding="utf-8", errors="replace"
            ).splitlines()
            ignore_specs.append((rel_dir, pathspec.GitIgnoreSpec.from_lines(lines)))

        dirnames[:] = sorted(
            d for d in dirnames
            if d not in SKIP_DIRS and not _ignored(_join(rel_dir, d) + "/", ignore_specs)
        )
        for name in sorted(filenames):
            rel_path = _join(rel_dir, name)
            if Path(name).suffix not in SOURCE_SUFFIXES or is_env_file(name):
                continue
            if _ignored(rel_path, ignore_specs):
                continue
            repo_file = _read_file(root / rel_path, rel_path)
            if repo_file:
                found.append(repo_file)
    return found


def _read_file(abs_path: Path, rel_path: str) -> RepoFile | None:
    """RepoFile with its hash, or None if too big or binary."""
    if abs_path.is_symlink():
        return None  # a link could point outside the repo
    size = abs_path.stat().st_size
    if size > MAX_FILE_BYTES:
        return None
    data = abs_path.read_bytes()
    if is_binary(data):
        return None
    return RepoFile(rel_path, abs_path, hashlib.sha256(data).hexdigest(), size)


def _join(rel_dir: str, name: str) -> str:
    return f"{rel_dir}/{name}" if rel_dir else name


def _ignored(rel_path: str, specs: list[tuple[str, pathspec.GitIgnoreSpec]]) -> bool:
    """True if any .gitignore at or above this path ignores it."""
    for base, spec in specs:
        if base and not rel_path.startswith(base + "/"):
            continue
        inner = rel_path[len(base) + 1:] if base else rel_path
        if spec.match_file(inner):
            return True
    return False
