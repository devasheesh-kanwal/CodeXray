"""Import and call graph (networkx). Call edges are a heuristic.

Node ids: file:<path>, class:<path>:<Name>, func:<path>:<name>,
func:<path>:<Class>.<method>. Edge types: imports, contains, calls.
Call edges carry confidence 'exact' or 'name_match'.
"""

import json
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

import networkx as nx

from app.api.schemas.repos import GraphEdge, GraphNode, RepoGraph
from app.indexing.skeleton import FileSkeleton, FunctionInfo, Skeleton


def file_id(path: str) -> str:
    return f"file:{path}"


def class_id(path: str, name: str) -> str:
    return f"class:{path}:{name}"


def func_id(path: str, name: str, class_name: str | None = None) -> str:
    return f"func:{path}:{class_name}.{name}" if class_name else f"func:{path}:{name}"


# ---------- modules and imports ----------


def module_names(path: str) -> list[str]:
    """Dotted module names a file can be imported as ('src/' layout included)."""
    parts = list(PurePosixPath(path).with_suffix("").parts)
    if parts[-1] == "__init__":
        parts = parts[:-1]
    names = [".".join(parts)] if parts else []
    if len(parts) > 1 and parts[0] == "src":
        names.append(".".join(parts[1:]))
    return names


def module_index(skeleton: Skeleton) -> dict[str, str]:
    """Dotted module name -> file path."""
    index: dict[str, str] = {}
    for file in skeleton.files:
        for name in module_names(file.path):
            index.setdefault(name, file.path)
    return index


def absolute_module(module: str, importer: str) -> str:
    """Turn a relative module ('.utils.helpers') into an absolute dotted name."""
    if not module.startswith("."):
        return module
    dots = len(module) - len(module.lstrip("."))
    package = list(PurePosixPath(importer).parent.parts)
    package = package[: len(package) - (dots - 1)] if dots > 1 else package
    rest = module.lstrip(".")
    return ".".join(package + ([rest] if rest else []))


@dataclass
class Bindings:
    """What the names in one file refer to."""

    modules: dict[str, str] = field(default_factory=dict)  # local name -> file path
    symbols: dict[str, str] = field(default_factory=dict)  # local name -> node id
    imported_files: set[str] = field(default_factory=set)


def file_bindings(file: FileSkeleton, skeleton: Skeleton, modules: dict[str, str]) -> Bindings:
    bindings = Bindings()
    for imp in file.imports:
        base = absolute_module(imp.module, file.path)
        if not imp.names:  # import a.b [as c]
            target = modules.get(base)
            if target:
                bindings.imported_files.add(target)
                if imp.alias:
                    bindings.modules[imp.alias] = target
                else:  # 'import a.b' binds 'a', reached as 'a.b'
                    for i in range(1, base.count(".") + 2):
                        prefix = ".".join(base.split(".")[:i])
                        if prefix in modules:
                            bindings.modules[prefix] = modules[prefix]
            continue
        for local, imported in imp.names.items():  # from a import b [as c]
            submodule = modules.get(f"{base}.{imported}")
            if submodule:
                bindings.modules[local] = submodule
                bindings.imported_files.add(submodule)
                continue
            target = modules.get(base)
            if target:
                bindings.imported_files.add(target)
                symbol = _top_level_symbol(skeleton.file(target), imported)
                if symbol:
                    bindings.symbols[local] = symbol
    return bindings


def _top_level_symbol(file: FileSkeleton | None, name: str) -> str | None:
    if file is None:
        return None
    if any(f.name == name for f in file.functions):
        return func_id(file.path, name)
    if any(c.name == name for c in file.classes):
        return class_id(file.path, name)
    return None


# ---------- building the graph ----------


def build_graph(skeleton: Skeleton) -> nx.DiGraph:
    graph = nx.DiGraph()
    modules = module_index(skeleton)
    _add_nodes(graph, skeleton)

    for file in skeleton.files:
        bindings = file_bindings(file, skeleton, modules)
        for target in sorted(bindings.imported_files - {file.path}):
            graph.add_edge(file_id(file.path), file_id(target), type="imports", confidence=None)
        for func in file.functions:
            _add_calls(graph, skeleton, file, func, None, bindings)
        for cls in file.classes:
            for method in cls.methods:
                _add_calls(graph, skeleton, file, method, cls.name, bindings)
    return graph


def _add_nodes(graph: nx.DiGraph, skeleton: Skeleton) -> None:
    for file in skeleton.files:
        fid = file_id(file.path)
        graph.add_node(fid, label=file.path, type="file", file=file.path,
                       start_line=1, end_line=max(file.line_count, 1))
        for func in file.functions:
            node = func_id(file.path, func.name)
            graph.add_node(node, label=func.name, type="function", file=file.path,
                           start_line=func.start_line, end_line=func.end_line)
            graph.add_edge(fid, node, type="contains", confidence=None)
        for cls in file.classes:
            cid = class_id(file.path, cls.name)
            graph.add_node(cid, label=cls.name, type="class", file=file.path,
                           start_line=cls.start_line, end_line=cls.end_line)
            graph.add_edge(fid, cid, type="contains", confidence=None)
            for method in cls.methods:
                mid = func_id(file.path, method.name, cls.name)
                graph.add_node(mid, label=f"{cls.name}.{method.name}", type="method",
                               file=file.path, start_line=method.start_line,
                               end_line=method.end_line)
                graph.add_edge(cid, mid, type="contains", confidence=None)


def _add_calls(graph, skeleton, file, func: FunctionInfo, class_name, bindings) -> None:
    caller = func_id(file.path, func.name, class_name)
    for call in func.calls:
        resolved = resolve_call(call, skeleton, file, class_name, bindings)
        if resolved and resolved[0] != caller:
            target, confidence = resolved
            graph.add_edge(caller, target, type="calls", confidence=confidence)


def resolve_call(
    call: str, skeleton: Skeleton, file: FileSkeleton, class_name: str | None, bindings: Bindings
) -> tuple[str, str] | None:
    """(target node id, 'exact' | 'name_match') for one call name, or None."""
    if "." not in call:
        local = _top_level_symbol(file, call)
        if local:
            return local, "exact"
        if call in bindings.symbols:
            return bindings.symbols[call], "exact"
        return None

    qualifier, name = call.rsplit(".", 1)
    if qualifier in ("self", "cls") and class_name:
        cls = next(c for c in file.classes if c.name == class_name)
        if any(m.name == name for m in cls.methods):
            return func_id(file.path, name, class_name), "exact"
    if qualifier in bindings.modules:
        target = _top_level_symbol(skeleton.file(bindings.modules[qualifier]), name)
        if target:
            return target, "exact"
    return _match_by_name(name, skeleton, file, bindings)


def _match_by_name(name, skeleton, file, bindings) -> tuple[str, str] | None:
    """`obj.name()`: unique definition in this file, else in an imported local module."""
    for paths in ([file.path], sorted(bindings.imported_files)):
        matches = [m for p in paths for m in _definitions_named(skeleton.file(p), name)]
        if len(matches) == 1:
            return matches[0], "name_match"
        if matches:
            return None  # ambiguous
    return None


def _definitions_named(file: FileSkeleton | None, name: str) -> list[str]:
    if file is None:
        return []
    found = [func_id(file.path, f.name) for f in file.functions if f.name == name]
    for cls in file.classes:
        found += [func_id(file.path, m.name, cls.name) for m in cls.methods if m.name == name]
    return found


# ---------- queries, storage, API ----------


def neighbors(graph: nx.DiGraph, symbol: str, hops: int = 1) -> dict[str, list[str]]:
    """Callers and callees of a symbol (node id) within `hops` call edges."""
    if symbol not in graph:
        return {"callers": [], "callees": []}

    def callers_of(node: str) -> list[str]:
        return [p for p in graph.predecessors(node) if graph.edges[p, node]["type"] == "calls"]

    def callees_of(node: str) -> list[str]:
        return [s for s in graph.successors(node) if graph.edges[node, s]["type"] == "calls"]

    def walk(step) -> list[str]:
        seen, frontier = {symbol}, [symbol]
        for _ in range(hops):
            frontier = [n for node in frontier for n in step(node) if n not in seen]
            seen.update(frontier)
        return sorted(seen - {symbol})

    return {"callers": walk(callers_of), "callees": walk(callees_of)}


def save_graph(graph: nx.DiGraph, path: Path) -> None:
    data = {
        "nodes": [{"id": n, **attrs} for n, attrs in graph.nodes(data=True)],
        "edges": [{"source": s, "target": t, **attrs} for s, t, attrs in graph.edges(data=True)],
    }
    path.write_text(json.dumps(data, indent=1), encoding="utf-8")


def load_graph(path: Path) -> nx.DiGraph:
    data = json.loads(path.read_text(encoding="utf-8"))
    graph = nx.DiGraph()
    for node in data["nodes"]:
        graph.add_node(node.pop("id"), **node)
    for edge in data["edges"]:
        graph.add_edge(edge.pop("source"), edge.pop("target"), **edge)
    return graph


def to_api(graph: nx.DiGraph) -> RepoGraph:
    """The Prompt 1 RepoGraph shape (methods are 'function' nodes; no confidence)."""
    return RepoGraph(
        nodes=[
            GraphNode(
                id=n,
                label=attrs["label"],
                type="function" if attrs["type"] == "method" else attrs["type"],
                file=attrs["file"],
            )
            for n, attrs in graph.nodes(data=True)
        ],
        edges=[
            GraphEdge(source=s, target=t, type=attrs["type"])
            for s, t, attrs in graph.edges(data=True)
        ],
    )
