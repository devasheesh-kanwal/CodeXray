"""Parse one Python file with tree-sitter into a FileSkeleton (no LLM)."""

import tree_sitter_python
from tree_sitter import Language, Node, Parser

from app.indexing.skeleton import ClassInfo, FileSkeleton, FunctionInfo, ImportInfo

PYTHON = Language(tree_sitter_python.language())


def parse_python(path: str, source: bytes, sha256: str) -> FileSkeleton:
    tree = Parser(PYTHON).parse(source)
    root = tree.root_node
    skeleton = FileSkeleton(
        path=path,
        sha256=sha256,
        line_count=len(source.decode("utf-8", errors="replace").splitlines()),
        imports=_imports(root),
        parse_error=root.has_error,
    )
    for node in root.children:
        definition, decorators = _unwrap(node)
        if definition is None:
            continue
        if definition.type == "function_definition":
            skeleton.functions.append(_function(node, definition, decorators))
        elif definition.type == "class_definition":
            skeleton.classes.append(_class(node, definition, decorators))
    return skeleton


def _text(node: Node | None) -> str:
    return node.text.decode("utf-8", errors="replace") if node else ""


def _unwrap(node: Node) -> tuple[Node | None, list[str]]:
    """(function/class node, decorator texts) for a top-level or class-body statement."""
    if node.type in ("function_definition", "class_definition"):
        return node, []
    if node.type == "decorated_definition":
        decorators = [
            _text(d).removeprefix("@").strip() for d in node.children if d.type == "decorator"
        ]
        return node.child_by_field_name("definition"), decorators
    return None, []


def _lines(outer: Node) -> tuple[int, int]:
    """1-based start/end line of a node (decorators included via the outer node)."""
    return outer.start_point.row + 1, outer.end_point.row + 1


def _docstring(definition: Node) -> str | None:
    body = definition.child_by_field_name("body")
    if not body or not body.named_children:
        return None
    first = body.named_children[0]
    if first.type != "expression_statement" or not first.named_children:
        return None
    string = first.named_children[0]
    if string.type != "string":
        return None
    content = "".join(_text(c) for c in string.children if c.type == "string_content")
    lines = [line.strip() for line in content.strip().splitlines()]
    return lines[0] if lines else None


def _signature(definition: Node) -> str:
    """'def name(params) -> type' (async kept), without the trailing colon."""
    body = definition.child_by_field_name("body")
    header = definition.text[: body.start_byte - definition.start_byte] if body else definition.text
    text = " ".join(header.decode("utf-8", errors="replace").split())
    return text.rstrip(":").rstrip()


def _function(outer: Node, definition: Node, decorators: list[str]) -> FunctionInfo:
    start, end = _lines(outer)
    return FunctionInfo(
        name=_text(definition.child_by_field_name("name")),
        signature=_signature(definition),
        start_line=start,
        end_line=end,
        docstring=_docstring(definition),
        decorators=decorators,
        calls=_calls(definition.child_by_field_name("body")),
    )


def _class(outer: Node, definition: Node, decorators: list[str]) -> ClassInfo:
    start, end = _lines(outer)
    bases = definition.child_by_field_name("superclasses")
    methods = []
    body = definition.child_by_field_name("body")
    for statement in body.children if body else []:
        method, method_decorators = _unwrap(statement)
        if method is not None and method.type == "function_definition":
            methods.append(_function(statement, method, method_decorators))
    return ClassInfo(
        name=_text(definition.child_by_field_name("name")),
        start_line=start,
        end_line=end,
        bases=[_text(b) for b in bases.named_children] if bases else [],
        decorators=decorators,
        docstring=_docstring(definition),
        methods=methods,
    )


def _calls(body: Node | None) -> list[str]:
    """Names of everything called inside body, in order, without duplicates.

    'save()' -> 'save', 'db.save()' -> 'db.save', 'make().get()' -> '?.get'.
    """
    found: list[str] = []
    stack = [body] if body else []
    while stack:
        node = stack.pop()
        if node.type == "call":
            name = _callee_name(node.child_by_field_name("function"))
            if name and name not in found:
                found.append(name)
        stack.extend(reversed(node.children))
    return found


def _callee_name(node: Node | None) -> str | None:
    if node is None:
        return None
    if node.type == "identifier":
        return _text(node)
    if node.type == "attribute":
        obj = node.child_by_field_name("object")
        attr = _text(node.child_by_field_name("attribute"))
        if obj is not None and obj.type in ("identifier", "attribute"):
            prefix = _callee_name(obj)
            if prefix and not prefix.startswith("?"):
                return f"{prefix}.{attr}"
        return f"?.{attr}"
    return None


def _imports(root: Node) -> list[ImportInfo]:
    """Every import statement in the file (any depth)."""
    imports: list[ImportInfo] = []
    stack = [root]
    while stack:
        node = stack.pop()
        line = node.start_point.row + 1
        if node.type == "import_statement":
            for item in node.named_children:
                imports.append(_plain_import(item, line))
        elif node.type == "import_from_statement":
            imports.append(_from_import(node, line))
        else:
            stack.extend(reversed(node.children))
    return sorted(imports, key=lambda i: i.line)


def _plain_import(item: Node, line: int) -> ImportInfo:
    if item.type == "aliased_import":
        return ImportInfo(
            module=_text(item.child_by_field_name("name")),
            alias=_text(item.child_by_field_name("alias")),
            line=line,
        )
    return ImportInfo(module=_text(item), line=line)


def _from_import(node: Node, line: int) -> ImportInfo:
    module_node = node.child_by_field_name("module_name")
    names: dict[str, str] = {}
    for item in node.children_by_field_name("name"):
        if item.type == "aliased_import":
            imported = _text(item.child_by_field_name("name"))
            names[_text(item.child_by_field_name("alias"))] = imported
        else:
            names[_text(item)] = _text(item)
    return ImportInfo(module=_text(module_node), names=names, line=line)
