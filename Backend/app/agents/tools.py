"""Tools agents can call. All are read-only except write_patch.

The registry checks the calling agent's allow-list, validates arguments with
Pydantic, and truncates long results with a "[truncated]" marker. A refused
or failed call returns an error result to the agent; it never raises.
"""

import inspect
import json
import logging
import subprocess
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from app.agents.state import RunState
from app.errors import ApiError
from app.indexing.context import make_snippet
from app.indexing.graph import neighbors
from app.indexing.search import RepoSearch
from app.indexing.service import IndexService

logger = logging.getLogger("codexray.agents")

MAX_READ_LINES = 200
GIT_TIMEOUT_S = 30


class ToolError(Exception):
    """A tool could not do what was asked; the message goes back to the agent."""


@dataclass
class ToolContext:
    index: IndexService
    repo_id: str
    state: RunState
    worktree: Path | None = None  # repair runs only (Prompt 6)
    worktrees_root: Path | None = None  # data/worktrees; write_patch only works inside it
    _searcher: RepoSearch | None = None

    def searcher(self) -> RepoSearch:
        if self._searcher is None:
            self._searcher = self.index.searcher(self.repo_id)
        return self._searcher


@dataclass
class ToolResult:
    text: str  # what the LLM sees
    summary: str  # one line for events and the agent trace
    ok: bool = True


@dataclass
class Tool:
    name: str
    description: str
    args: type[BaseModel]
    func: Callable[[ToolContext, Any], Any]  # returns ToolResult (sync or async)
    max_result_tokens: int

    def openai_spec(self) -> dict[str, Any]:
        """The tool in OpenAI function-calling format."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.args.model_json_schema(),
            },
        }


def truncate(text: str, max_tokens: int) -> str:
    limit = max_tokens * 4  # ~4 characters per token
    return text if len(text) <= limit else text[:limit] + "\n[truncated]"


class ToolRegistry:
    def __init__(self, tools: Iterable[Tool]) -> None:
        self.tools = {tool.name: tool for tool in tools}

    def specs(self, names: Iterable[str]) -> list[dict[str, Any]]:
        return [self.tools[n].openai_spec() for n in names if n in self.tools]

    def describe(self, names: Iterable[str]) -> str:
        """Tool list for the JSON protocol (models without native tool calling)."""
        lines = []
        for name in names:
            tool = self.tools[name]
            params = json.dumps(tool.args.model_json_schema().get("properties", {}))
            lines.append(f"- {name}: {tool.description} Args: {params}")
        return "\n".join(lines)

    async def call(
        self, name: str, raw_args: Any, ctx: ToolContext, allowed: Iterable[str], agent: str
    ) -> ToolResult:
        if name not in allowed:
            logger.warning("Agent %s tried tool %s, which it is not allowed to use", agent, name)
            return ToolResult(f"Error: tool '{name}' is not allowed for agent '{agent}'.",
                              f"refused: {name} not allowed", ok=False)
        tool = self.tools.get(name)
        if tool is None:
            return ToolResult(f"Error: there is no tool named '{name}'.", f"unknown tool {name}", ok=False)
        try:
            data = json.loads(raw_args) if isinstance(raw_args, str) else (raw_args or {})
            args = tool.args.model_validate(data)
        except (json.JSONDecodeError, ValidationError) as exc:
            return ToolResult(f"Error: invalid arguments for {name}: {exc}", f"bad args for {name}", ok=False)
        try:
            result = tool.func(ctx, args)
            if inspect.isawaitable(result):
                result = await result
        except ToolError as exc:
            return ToolResult(f"Error: {exc}", f"{name} failed: {str(exc)[:80]}", ok=False)
        except Exception:
            logger.exception("Tool %s crashed", name)
            return ToolResult(f"Error: tool {name} failed unexpectedly.", f"{name} crashed", ok=False)
        result.text = truncate(result.text, tool.max_result_tokens)
        return result


# ---------- search_code ----------


class SearchArgs(BaseModel):
    query: str = Field(min_length=1, description="Words, identifiers or a question")
    k: int = Field(default=8, ge=1, le=20, description="How many results")


async def search_code(ctx: ToolContext, args: SearchArgs) -> ToolResult:
    searcher = ctx.searcher()
    result = await searcher.search(args.query, args.k)
    _record_search(ctx.state, result.best_score, result.mode)
    if not result.hits:
        return ToolResult(f"No results for '{args.query}' (mode: {result.mode}).", "no results")
    parts = [f"mode: {result.mode} | best_score: {result.best_score}"]
    for i, hit in enumerate(result.hits, start=1):
        snippet = make_snippet(searcher.chunks[hit.chunk_id], "search")
        parts.append(
            f"\n{i}. {hit.file}:{hit.start_line}-{hit.end_line} {hit.symbol} "
            f"(score {hit.score:.4f}, found_by {hit.method})\n{snippet.text}"
        )
    top = result.hits[0]
    return ToolResult("\n".join(parts),
                      f"{len(result.hits)} results ({result.mode}); top {top.file}:{top.start_line}-{top.end_line}")


def _record_search(state: RunState, best_score: float, mode: str) -> None:
    """Keep the best score this run has seen, for plain-code "not found" gates."""
    seen = state.artifacts.get("search") or {"best_score": 0.0, "mode": mode, "queries": 0}
    seen["best_score"] = max(seen["best_score"], best_score)
    seen["mode"] = mode
    seen["queries"] += 1
    state.artifacts["search"] = seen


# ---------- read_skeleton ----------


class SkeletonArgs(BaseModel):
    path: str | None = Field(default=None, description="One file; omit for the whole repo outline")


NO_PATH = {"", "none", "null", "/", "."}  # what models send when they mean "no path"


def read_skeleton(ctx: ToolContext, args: SkeletonArgs) -> ToolResult:
    skeleton = ctx.index.skeleton(ctx.repo_id)
    if args.path is None or args.path.strip().lower() in NO_PATH:
        lines = []
        for f in skeleton.files:
            lines.append(f"{f.path} ({f.line_count} lines)" + (f": {f.summary}" if f.summary else ""))
            lines += [f"  class {c.name} [{c.start_line}-{c.end_line}]: "
                      + ", ".join(m.name for m in c.methods) for c in f.classes]
            lines += [f"  {fn.signature} [{fn.start_line}-{fn.end_line}]" for fn in f.functions]
        return ToolResult("\n".join(lines), f"outline of {len(skeleton.files)} files")

    file = skeleton.file(args.path.replace("\\", "/"))
    if file is None:
        raise ToolError(f"'{args.path}' is not an indexed file")
    lines = [f"{file.path} ({file.line_count} lines)"]
    lines += [f"import: {i.module}" + (f" ({', '.join(i.names)})" if i.names else "") for i in file.imports]
    for c in file.classes:
        lines.append(f"class {c.name} [{c.start_line}-{c.end_line}]" + (f": {c.docstring}" if c.docstring else ""))
        lines += [f"  {m.signature} [{m.start_line}-{m.end_line}]" for m in c.methods]
    for fn in file.functions:
        decorators = "".join(f"@{d} " for d in fn.decorators)
        lines.append(f"{decorators}{fn.signature} [{fn.start_line}-{fn.end_line}]"
                     + (f": {fn.docstring}" if fn.docstring else ""))
    return ToolResult("\n".join(lines), f"skeleton of {file.path}")


# ---------- get_neighbors ----------


class NeighborArgs(BaseModel):
    symbol: str = Field(min_length=1, description="Function/method name, 'Class.method' or a node id")
    hops: int = Field(default=1, ge=1, le=2)


def get_neighbors(ctx: ToolContext, args: NeighborArgs) -> ToolResult:
    graph = ctx.index.load_graph(ctx.repo_id)
    node = _find_node(graph, args.symbol)
    found = neighbors(graph, node, args.hops)

    def section(title: str, node_ids: list[str]) -> list[str]:
        lines = [f"{title}:"]
        for node_id in node_ids:
            attrs = graph.nodes[node_id]
            lines.append(f"  {attrs['label']} [{attrs['file']}:{attrs['start_line']}-{attrs['end_line']}]")
        return lines if node_ids else [f"{title}:", "  (none found)"]

    text = "\n".join([
        f"{graph.nodes[node]['label']} [{graph.nodes[node]['file']}]",
        *section("callers", found["callers"]),
        *section("callees", found["callees"]),
    ])
    return ToolResult(text, f"{len(found['callers'])} callers, {len(found['callees'])} callees of {args.symbol}")


def _find_node(graph, symbol: str) -> str:
    if symbol in graph:
        return symbol
    matches = [
        n for n, attrs in graph.nodes(data=True)
        if attrs["type"] != "file" and (attrs["label"] == symbol or attrs["label"].endswith(f".{symbol}"))
    ]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise ToolError(f"no function or class named '{symbol}' in the graph")
    raise ToolError(f"'{symbol}' is ambiguous; use one of: {', '.join(matches[:10])}")


# ---------- read_file ----------


class ReadFileArgs(BaseModel):
    path: str = Field(min_length=1, description="Repo-relative path")
    start: int = Field(default=1, ge=1)
    end: int | None = Field(default=None, ge=1, description=f"Inclusive; at most {MAX_READ_LINES} lines")


def read_file(ctx: ToolContext, args: ReadFileArgs) -> ToolResult:
    path = args.path.replace("\\", "/").strip("/")
    lines = _worktree_lines(ctx.worktree, path) if ctx.worktree else _index_lines(ctx, path)
    if args.start > len(lines):
        raise ToolError(f"{path} has only {len(lines)} lines")
    end = min(args.end or args.start + MAX_READ_LINES - 1, len(lines),
              args.start + MAX_READ_LINES - 1)
    numbered = [f"{n:5} | {lines[n - 1]}" for n in range(args.start, end + 1)]
    note = f"\n(showing {args.start}-{end} of {len(lines)} lines)" if end < len(lines) else ""
    return ToolResult(f"{path}:{args.start}-{end}\n" + "\n".join(numbered) + note,
                      f"read {path}:{args.start}-{end}")


def _index_lines(ctx: ToolContext, path: str) -> list[str]:
    try:
        return ctx.index.file_lines(ctx.repo_id, path)
    except ApiError as exc:
        raise ToolError(f"cannot read '{path}': {exc.message}") from exc


def _worktree_lines(worktree: Path, path: str) -> list[str]:
    root = worktree.resolve()
    full = (root / path).resolve()
    if not full.is_relative_to(root) or not full.is_file():
        raise ToolError(f"cannot read '{path}': not a file inside the repo")
    return full.read_text(encoding="utf-8", errors="replace").splitlines()


# ---------- read_test_output ----------


class TestOutputArgs(BaseModel):
    run_id: str


def read_test_output(ctx: ToolContext, args: TestOutputArgs) -> ToolResult:
    if args.run_id != ctx.state.run_id:
        raise ToolError("you can only read the test output of the current run")
    results = ctx.state.artifacts.get("test_results") or []
    if not results:
        return ToolResult("No test results yet for this run.", "no test results yet")
    latest = results[-1]
    header = f"attempt {latest.get('attempt', '?')}: {latest.get('passed', '?')} passed, {latest.get('failed', '?')} failed"
    return ToolResult(f"{header}\n{latest.get('output', '')}", header)


# ---------- write_patch ----------


class PatchArgs(BaseModel):
    diff: str = Field(min_length=1, description="A unified diff (git format) relative to the repo root")


def is_test_path(path: str) -> bool:
    parts = PurePosixPath(path).parts
    name = parts[-1] if parts else ""
    return (
        any(p in ("tests", "test") for p in parts[:-1])
        or name.startswith("test_") or name.endswith("_test.py") or name == "conftest.py"
    )


def patched_paths(diff: str) -> list[str]:
    """Files a unified diff touches (from its ---/+++ lines)."""
    paths = []
    for line in diff.splitlines():
        if line.startswith(("--- ", "+++ ")):
            path = line[4:].split("\t")[0].strip()
            if path != "/dev/null":
                path = path[2:] if path[:2] in ("a/", "b/") else path
                if path not in paths:
                    paths.append(path)
    return paths


def write_patch(ctx: ToolContext, args: PatchArgs) -> ToolResult:
    if ctx.worktree is None or ctx.worktrees_root is None:
        raise ToolError("no worktree for this run; patches can only be written in a repair run")
    worktree = ctx.worktree.resolve()
    if not worktree.is_relative_to(ctx.worktrees_root.resolve()):
        raise ToolError("refusing to write outside the repair worktrees folder")
    paths = patched_paths(args.diff)
    if not paths:
        raise ToolError("the diff names no files (expected ---/+++ lines)")
    tests = [p for p in paths if is_test_path(p)]
    if tests:
        raise ToolError(f"test files must never be edited: {', '.join(tests)}")

    diff = args.diff if args.diff.endswith("\n") else args.diff + "\n"
    for command in (["git", "apply", "--check", "-"], ["git", "apply", "-"]):
        # Bytes, not text: text mode on Windows would turn \n into \r\n and break the diff.
        result = subprocess.run(command, cwd=worktree, input=diff.encode("utf-8"),
                                capture_output=True, timeout=GIT_TIMEOUT_S)
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace").strip()
            raise ToolError(f"patch does not apply: {stderr[:500]}")
    previous = ctx.state.artifacts.get("patch") or ""
    ctx.state.artifacts["patch"] = previous + diff
    return ToolResult(f"Patch applied to: {', '.join(paths)}", f"patched {len(paths)} file(s)")


def default_registry() -> ToolRegistry:
    return ToolRegistry([
        Tool("search_code", "Hybrid keyword + meaning search over the indexed code. "
             "Returns snippets with file, lines, score and found_by.", SearchArgs, search_code, 2500),
        Tool("read_skeleton", "Outline of the repo (no path) or of one file: classes, "
             "functions, signatures and line ranges.", SkeletonArgs, read_skeleton, 2500),
        Tool("get_neighbors", "Callers and callees of a function or class from the call graph.",
             NeighborArgs, get_neighbors, 800),
        Tool("read_file", f"Read lines of one file (at most {MAX_READ_LINES} lines per call).",
             ReadFileArgs, read_file, 3000),
        Tool("read_test_output", "Latest test output of the current repair run.",
             TestOutputArgs, read_test_output, 2000),
        Tool("write_patch", "Apply a unified diff to the repair worktree (never test files).",
             PatchArgs, write_patch, 300),
    ])
