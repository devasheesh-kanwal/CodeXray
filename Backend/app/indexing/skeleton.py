"""Skeleton models (the structure map of a repo) and conversion to the API tree."""

from pathlib import Path

from pydantic import BaseModel, Field

from app.api.schemas.repos import RepoTree, Symbol, TreeNode


class ImportInfo(BaseModel):
    """`import a.b as c` -> module='a.b', alias='c'.
    `from .m import x as y` -> module='.m', names={'y': 'x'} (local name -> imported name).
    """

    module: str
    names: dict[str, str] = Field(default_factory=dict)
    alias: str | None = None
    line: int


class FunctionInfo(BaseModel):
    name: str
    signature: str
    start_line: int  # first decorator line if decorated
    end_line: int
    docstring: str | None = None  # first line only
    decorators: list[str] = Field(default_factory=list)
    calls: list[str] = Field(default_factory=list)  # e.g. 'db.save_user', 'self.x', '?.get'


class ClassInfo(BaseModel):
    name: str
    start_line: int
    end_line: int
    bases: list[str] = Field(default_factory=list)
    decorators: list[str] = Field(default_factory=list)
    docstring: str | None = None
    methods: list[FunctionInfo] = Field(default_factory=list)


class FileSkeleton(BaseModel):
    path: str
    language: str = "python"
    sha256: str
    line_count: int
    imports: list[ImportInfo] = Field(default_factory=list)
    classes: list[ClassInfo] = Field(default_factory=list)
    functions: list[FunctionInfo] = Field(default_factory=list)
    summary: str | None = None  # only when FILE_SUMMARIES=true
    parse_error: bool = False  # tree-sitter found syntax errors (best-effort result)


class Skeleton(BaseModel):
    repo_id: str
    name: str
    files: list[FileSkeleton]

    def file(self, path: str) -> FileSkeleton | None:
        return next((f for f in self.files if f.path == path), None)


def save_skeleton(skeleton: Skeleton, path: Path) -> None:
    path.write_text(skeleton.model_dump_json(indent=1), encoding="utf-8")


def load_skeleton(path: Path) -> Skeleton:
    return Skeleton.model_validate_json(path.read_text(encoding="utf-8"))


# ---------- API tree (GET /api/repos/{id}/tree) ----------


def to_tree(skeleton: Skeleton) -> RepoTree:
    """Folders -> files -> symbols, in the Prompt 1 TreeNode shape."""
    root = TreeNode(name=skeleton.name, path="", type="folder")
    folders: dict[str, TreeNode] = {"": root}

    for file in sorted(skeleton.files, key=lambda f: f.path):
        parent = _folder_for(Path(file.path).parent.as_posix(), folders)
        parent.children.append(
            TreeNode(
                name=Path(file.path).name,
                path=file.path,
                type="file",
                symbols=_symbols(file),
            )
        )
    return RepoTree(repo_id=skeleton.repo_id, root=root)


def _folder_for(folder_path: str, folders: dict[str, TreeNode]) -> TreeNode:
    folder_path = "" if folder_path == "." else folder_path
    if folder_path not in folders:
        parent = _folder_for(Path(folder_path).parent.as_posix(), folders)
        node = TreeNode(name=Path(folder_path).name, path=folder_path, type="folder")
        parent.children.append(node)
        folders[folder_path] = node
    return folders[folder_path]


def _symbols(file: FileSkeleton) -> list[Symbol]:
    symbols = [
        Symbol(
            name=c.name, kind="class", start_line=c.start_line, end_line=c.end_line,
            children=[
                Symbol(name=m.name, kind="method", start_line=m.start_line, end_line=m.end_line)
                for m in c.methods
            ],
        )
        for c in file.classes
    ]
    symbols += [
        Symbol(name=f.name, kind="function", start_line=f.start_line, end_line=f.end_line)
        for f in file.functions
    ]
    return sorted(symbols, key=lambda s: s.start_line)
