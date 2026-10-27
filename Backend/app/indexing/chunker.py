"""Split files into search chunks: one per function/method, class header, module code."""

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from app.indexing.graph import class_id, file_id, func_id
from app.indexing.skeleton import FileSkeleton

ChunkKind = Literal["function", "method", "class", "module"]
MODULE_SYMBOL = "<module>"


class Chunk(BaseModel):
    id: str
    file: str
    symbol: str  # 'get_user', 'User.to_dict', 'User' (class header) or '<module>'
    kind: ChunkKind
    start_line: int
    end_line: int
    text: str  # starts with a '# file: ... | symbol: ...' line for context
    node_id: str  # matching graph node


def chunk_file(file: FileSkeleton, lines: list[str]) -> list[Chunk]:
    """All chunks of one file. `lines` is the file content split into lines."""
    chunks = [
        _chunk(file.path, f.name, "function", f.start_line, f.end_line, lines,
               func_id(file.path, f.name))
        for f in file.functions
    ]
    for cls in file.classes:
        header_end = _class_header_end(cls.start_line, cls.end_line,
                                       [m.start_line for m in cls.methods], lines)
        chunks.append(_chunk(file.path, cls.name, "class", cls.start_line, header_end, lines,
                             class_id(file.path, cls.name)))
        chunks += [
            _chunk(file.path, f"{cls.name}.{m.name}", "method", m.start_line, m.end_line, lines,
                   func_id(file.path, m.name, cls.name))
            for m in cls.methods
        ]
    module_chunk = _module_chunk(file, lines)
    if module_chunk:
        chunks.append(module_chunk)
    return sorted(chunks, key=lambda c: c.start_line)


def _chunk(path, symbol, kind, start, end, lines, node_id) -> Chunk:
    code = "\n".join(lines[start - 1 : end])
    return Chunk(
        id=f"{path}::{symbol}::{start}",
        file=path,
        symbol=symbol,
        kind=kind,
        start_line=start,
        end_line=end,
        text=f"# file: {path} | symbol: {symbol}\n{code}",
        node_id=node_id,
    )


def _class_header_end(start: int, end: int, method_starts: list[int], lines: list[str]) -> int:
    """Last non-blank line before the first method (the whole class if no methods)."""
    last = (min(method_starts) - 1) if method_starts else end
    while last > start and not lines[last - 1].strip():
        last -= 1
    return last


def _module_chunk(file: FileSkeleton, lines: list[str]) -> Chunk | None:
    """Code outside every top-level function and class (imports, constants, main block)."""
    inside: set[int] = set()
    for item in [*file.functions, *file.classes]:
        inside.update(range(item.start_line, item.end_line + 1))
    numbers = [n for n in range(1, len(lines) + 1) if n not in inside and lines[n - 1].strip()]
    if not numbers:
        return None
    code = "\n".join(lines[n - 1] for n in numbers)
    return Chunk(
        id=f"{file.path}::{MODULE_SYMBOL}::{numbers[0]}",
        file=file.path,
        symbol=MODULE_SYMBOL,
        kind="module",
        start_line=numbers[0],
        end_line=numbers[-1],
        text=f"# file: {file.path} | symbol: {MODULE_SYMBOL}\n{code}",
        node_id=file_id(file.path),
    )


def save_chunks(chunks: list[Chunk], path: Path) -> None:
    path.write_text(json.dumps([c.model_dump() for c in chunks], indent=1), encoding="utf-8")


def load_chunks(path: Path) -> list[Chunk]:
    return [Chunk.model_validate(c) for c in json.loads(path.read_text(encoding="utf-8"))]
