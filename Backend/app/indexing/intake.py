"""Repo intake: ids, cloning, and the per-repo meta.json (status + counts)."""

import hashlib
import os
import re
import shutil
import stat
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from app.api.schemas.repos import RepoStage
from app.atomic import write_text_atomic

CLONE_TIMEOUT_S = 300
GIT_URL = re.compile(r"^(https://|ssh://|git@)[^\s]+$")
ACTIVE_STAGES = {"queued", "cloning", "parsing", "graph", "bm25", "embedding", "summaries"}


class IndexingError(Exception):
    """Indexing cannot continue (bad input, clone failure, ...)."""


class RepoMeta(BaseModel):
    """Everything we know about one repo, saved as data/<repo_id>/meta.json."""

    repo_id: str
    name: str
    source: str  # the git URL or the local path the user gave
    kind: Literal["git", "local"]
    root: str  # folder that holds the code
    stage: RepoStage = "queued"
    files_done: int = 0
    files_total: int = 0
    chunks_total: int | None = None
    chunks_embedded: int | None = None
    search_mode: Literal["hybrid", "bm25_only"] | None = None
    embedding_model: str | None = None
    error: str | None = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


def repo_name(source: str) -> str:
    """'https://github.com/a/flask-todo.git' or 'C:/code/flask-todo' -> 'flask-todo'."""
    last = re.split(r"[/\\:]", source.rstrip("/\\"))[-1]
    return last.removesuffix(".git") or "repo"


def repo_id_for(source: str) -> str:
    """Stable id: the same source always gets the same id."""
    slug = re.sub(r"[^a-z0-9]+", "-", repo_name(source).lower()).strip("-") or "repo"
    digest = hashlib.sha256(source.strip().encode("utf-8")).hexdigest()[:8]
    return f"{slug[:40]}-{digest}"


def normalize_local_path(local_path: str) -> Path:
    path = Path(local_path).expanduser().resolve()
    if not path.is_dir():
        raise IndexingError(f"local_path is not an existing folder: {local_path}")
    return path


def check_git_url(url: str) -> str:
    url = url.strip()
    if not GIT_URL.match(url):
        raise IndexingError("git_url must start with https://, ssh:// or git@")
    return url


def clone(url: str, dest: Path) -> None:
    """Shallow-clone url into dest, replacing an older clone."""
    if dest.exists():
        remove_tree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}  # never wait for a password
    try:
        result = subprocess.run(
            ["git", "clone", "--depth", "1", "--", url, str(dest)],
            capture_output=True, text=True, timeout=CLONE_TIMEOUT_S, env=env,
        )
    except subprocess.TimeoutExpired as exc:
        raise IndexingError(f"git clone timed out after {CLONE_TIMEOUT_S}s") from exc
    if result.returncode != 0:
        last_line = (result.stderr.strip().splitlines() or ["unknown error"])[-1]
        raise IndexingError(f"git clone failed: {last_line}")


def remove_tree(path: Path) -> None:
    """rmtree that also removes read-only files (git objects on Windows)."""

    def make_writable_and_retry(func, failed_path, _exc):
        os.chmod(failed_path, stat.S_IWRITE)
        func(failed_path)

    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=make_writable_and_retry)
    else:  # Python 3.11
        shutil.rmtree(path, onerror=make_writable_and_retry)


# ---------- meta.json registry ----------


def repo_dir(data_dir: Path, repo_id: str) -> Path:
    return data_dir / repo_id


def save_meta(data_dir: Path, meta: RepoMeta) -> None:
    meta.updated_at = datetime.now(UTC)
    folder = repo_dir(data_dir, meta.repo_id)
    folder.mkdir(parents=True, exist_ok=True)
    write_text_atomic(folder / "meta.json", meta.model_dump_json(indent=2))


def load_meta(data_dir: Path, repo_id: str) -> RepoMeta | None:
    path = repo_dir(data_dir, repo_id) / "meta.json"
    if not path.is_file():
        return None
    return RepoMeta.model_validate_json(path.read_text(encoding="utf-8"))


def list_metas(data_dir: Path) -> list[RepoMeta]:
    if not data_dir.is_dir():
        return []
    metas = [load_meta(data_dir, p.name) for p in sorted(data_dir.iterdir()) if p.is_dir()]
    return [m for m in metas if m]
