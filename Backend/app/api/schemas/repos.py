"""Models for /api/repos: listing, adding, status, tree, graph, file, rules."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

RepoStage = Literal[
    "queued",
    "cloning",
    "parsing",
    "graph",
    "bm25",
    "embedding",
    "summaries",
    "ready",
    "failed",
]


class RepoSummary(BaseModel):
    repo_id: str
    name: str
    status: RepoStage
    files_total: int = Field(ge=0)


class AddRepoRequest(BaseModel):
    """Exactly one of git_url or local_path."""

    git_url: str | None = None
    local_path: str | None = None

    @model_validator(mode="after")
    def exactly_one_source(self) -> AddRepoRequest:
        if bool(self.git_url) == bool(self.local_path):
            raise ValueError("give exactly one of git_url or local_path")
        return self


class AddRepoResponse(BaseModel):
    repo_id: str
    status: RepoStage


class RepoStatus(BaseModel):
    stage: RepoStage
    files_done: int = Field(ge=0)
    files_total: int = Field(ge=0)
    error: str | None = None
    chunks_total: int | None = Field(default=None, ge=0)
    chunks_embedded: int | None = Field(default=None, ge=0)
    search_mode: Literal["hybrid", "bm25_only"] | None = None


class Symbol(BaseModel):
    """A class, function, or method with its line range."""

    name: str
    kind: Literal["class", "function", "method"]
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    children: list[Symbol] = Field(default_factory=list)


class TreeNode(BaseModel):
    """A folder (with children) or a file (with symbols). Paths use '/'."""

    name: str
    path: str
    type: Literal["folder", "file"]
    children: list[TreeNode] = Field(default_factory=list)
    symbols: list[Symbol] = Field(default_factory=list)


class RepoTree(BaseModel):
    repo_id: str
    root: TreeNode


class GraphNode(BaseModel):
    id: str
    label: str
    type: Literal["file", "class", "function"]
    file: str


class GraphEdge(BaseModel):
    source: str
    target: str
    type: Literal["imports", "calls", "contains"]


class RepoGraph(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class FileSlice(BaseModel):
    """Lines start..end (1-based, inclusive) of one file."""

    path: str
    start: int = Field(ge=1)
    end: int = Field(ge=1)
    lines: list[str]


class DesignRule(BaseModel):
    id: str
    title: str
    description: str
    severity: Literal["critical", "high", "medium", "low"]
    enabled: bool


class RulesResponse(BaseModel):
    rules: list[DesignRule]
