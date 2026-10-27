"""/api/repos: add and list repos, indexing status, tree, graph, file, rules."""

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request

from app.api.deps import get_settings
from app.api.schemas.repos import (
    AddRepoRequest,
    AddRepoResponse,
    FileSlice,
    RepoGraph,
    RepoStatus,
    RepoSummary,
    RepoTree,
    RulesResponse,
)
from app.config import Settings
from app.errors import ApiError, not_found, not_implemented
from app.indexing.service import IndexService
from app.mocks.loader import get_fixture

router = APIRouter(prefix="/api/repos", tags=["repos"])


def get_index(request: Request) -> IndexService:
    return request.app.state.index_service


@router.get("", response_model=list[RepoSummary])
def list_repos(
    settings: Settings = Depends(get_settings), index: IndexService = Depends(get_index)
) -> list[RepoSummary]:
    if settings.mock_mode:
        return get_fixture("repos")
    return index.list_repos()


@router.post("", response_model=AddRepoResponse, status_code=202)
def add_repo(
    body: AddRepoRequest,
    background: BackgroundTasks,
    settings: Settings = Depends(get_settings),
    index: IndexService = Depends(get_index),
) -> AddRepoResponse:
    """Start indexing a repo from a git URL or a local path (runs in the background)."""
    if settings.mock_mode:
        return AddRepoResponse(repo_id="repo_" + uuid.uuid4().hex[:8], status="queued")
    meta = index.add_repo(body.git_url, body.local_path)
    background.add_task(index.index, meta.repo_id)
    return AddRepoResponse(repo_id=meta.repo_id, status=meta.stage)


@router.get("/{repo_id}/status", response_model=RepoStatus)
def repo_status(
    repo_id: str,
    settings: Settings = Depends(get_settings),
    index: IndexService = Depends(get_index),
) -> RepoStatus:
    if settings.mock_mode:
        return get_fixture("repo_status")
    return index.status(repo_id)


@router.get("/{repo_id}/tree", response_model=RepoTree)
def repo_tree(
    repo_id: str,
    settings: Settings = Depends(get_settings),
    index: IndexService = Depends(get_index),
) -> RepoTree:
    """Skeleton tree: folders, files, and symbols with line ranges."""
    if settings.mock_mode:
        return get_fixture("tree").model_copy(update={"repo_id": repo_id})
    return index.tree(repo_id)


@router.get("/{repo_id}/graph", response_model=RepoGraph)
def repo_graph(
    repo_id: str,
    settings: Settings = Depends(get_settings),
    index: IndexService = Depends(get_index),
) -> RepoGraph:
    """Approximate import/call graph."""
    if settings.mock_mode:
        return get_fixture("graph")
    return index.graph(repo_id)


@router.get("/{repo_id}/file", response_model=FileSlice)
def read_file(
    repo_id: str,
    path: str = Query(min_length=1, description="Repo-relative path, e.g. app/db.py"),
    start: int = Query(1, ge=1, description="First line, 1-based"),
    end: int | None = Query(None, ge=1, description="Last line, inclusive; default: end of file"),
    settings: Settings = Depends(get_settings),
    index: IndexService = Depends(get_index),
) -> FileSlice:
    path = path.replace("\\", "/")
    if settings.mock_mode:
        lines = get_fixture("files").files.get(path)
        if lines is None:
            raise not_found("File", path=path)
    else:
        lines = index.file_lines(repo_id, path)
    return slice_lines(path, lines, start, end)


def slice_lines(path: str, lines: list[str], start: int, end: int | None) -> FileSlice:
    """Lines start..end (inclusive, clamped to the file length)."""
    end = min(end or len(lines), len(lines))
    if start > len(lines) or end < start:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            f"Invalid line range {start}-{end} for a {len(lines)}-line file",
            {"path": path, "line_count": len(lines)},
        )
    return FileSlice(path=path, start=start, end=end, lines=lines[start - 1 : end])


@router.get("/{repo_id}/rules", response_model=RulesResponse)
def repo_rules(repo_id: str, settings: Settings = Depends(get_settings)) -> RulesResponse:
    """Active design rules used by the PR review."""
    if not settings.mock_mode:
        raise not_implemented("Design rules", "5")
    return get_fixture("rules")
