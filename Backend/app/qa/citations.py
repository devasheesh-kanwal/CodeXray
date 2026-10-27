"""Citation checker (plain code): keep only [file:start-end] markers we can prove.

A marker is kept when its file is in the index, its lines exist, and its range
overlaps code the Explainer actually received (a snippet or a read_file result).
Loose variants (in backticks, without brackets, one line) are normalized first.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

from app.api.schemas.common import Citation

MARKER = re.compile(r"\[([^\[\]:]+):(\d+)-(\d+)\]")  # the same regex as docs/API.md
# Variants models write instead; normalize_markers() turns them into [file:start-end].
LOOSE_MARKERS = [
    re.compile(r"`\[([^\[\]:`]+):(\d+)(?:-(\d+))?\]`"),  # `[file:a-b]`
    re.compile(r"`([\w./\\-]+\.\w+):(\d+)(?:-(\d+))?`"),  # `file.py:a-b` (no brackets)
    re.compile(r"\[([^\[\]:]+):(\d+)\]"),  # [file:5] (one line)
]
# Several references in one bracket: [a.py:1-2, b.py:5] (split before the rest)
GROUPED_MARKER = re.compile(r"\[([^\[\]:,;]+:\d+(?:-\d+)?(?:\s*[,;]\s*[^\[\]:,;]+:\d+(?:-\d+)?)+)\]")
SENTENCE_END = re.compile(r"[.!?](?:\s+|$)|\n")
NOT_FOUND_LINE = "NOT_FOUND"
NOT_FOUND_ANSWER = "No relevant code found for this question"
CONFIDENCE = {"high": 0.9, "medium": 0.6, "low": 0.3, "none": 0.0}
MAX_WHY_CHARS = 300

Range = tuple[str, int, int]  # (file, start_line, end_line)
Level = Literal["high", "medium", "low", "none"]


@dataclass
class Dropped:
    marker: str  # e.g. "[shop/api.py:3-9]"
    reason: str


@dataclass
class CheckResult:
    answer: str  # dropped markers removed; the not-found sentence when not_found
    citations: list[Citation] = field(default_factory=list)
    dropped: list[Dropped] = field(default_factory=list)
    markers_total: int = 0
    level: Level = "none"
    not_found: bool = False

    @property
    def confidence(self) -> float:
        return CONFIDENCE[self.level]


def normalize_markers(answer: str) -> str:
    """Rewrite `[f:a-b]`, `f.py:a-b`, [f:a] and [f:a-b, g:c] as [f:a-b] markers."""
    def rewrite(match: re.Match) -> str:
        file, start, end = (*match.groups(), None)[:3]
        return f"[{file}:{start}-{end or start}]"

    def split_group(match: re.Match) -> str:
        return " ".join(f"[{ref.strip()}]" for ref in re.split(r"[,;]", match.group(1)))

    answer = GROUPED_MARKER.sub(split_group, answer)
    for pattern in LOOSE_MARKERS:
        answer = pattern.sub(rewrite, answer)
    return answer


def says_not_found(answer: str) -> bool:
    """True if the reply starts with the NOT_FOUND line."""
    return answer.lstrip().startswith(NOT_FOUND_LINE)


def check_citations(
    answer: str,
    received: list[Range],
    line_count: Callable[[str], int | None],
) -> CheckResult:
    """Verify every marker in the answer.

    line_count(file) is the file's number of lines, or None if it is not indexed.
    """
    if says_not_found(answer):
        return CheckResult(answer=NOT_FOUND_ANSWER, not_found=True)

    answer = normalize_markers(answer)
    citations: dict[Range, Citation] = {}
    dropped: list[Dropped] = []
    matches = list(MARKER.finditer(answer))
    for match in matches:
        file, start, end = match.group(1), int(match.group(2)), int(match.group(3))
        reason = _problem(file, start, end, received, line_count)
        if reason:
            dropped.append(Dropped(match.group(0), reason))
        elif (file, start, end) not in citations:
            citations[(file, start, end)] = Citation(
                file=file, start_line=start, end_line=end, why=_sentence_before(answer, match.start())
            )

    level = _level(len(matches), len(dropped))
    if matches and len(dropped) == len(matches):
        return CheckResult(answer=NOT_FOUND_ANSWER, dropped=dropped,
                           markers_total=len(matches), level="none", not_found=True)
    return CheckResult(
        answer=_strip_markers(answer, {d.marker for d in dropped}),
        citations=list(citations.values()),
        dropped=dropped,
        markers_total=len(matches),
        level=level,
    )


def _problem(file: str, start: int, end: int, received: list[Range], line_count) -> str | None:
    """Why a marker must be dropped, or None if it is fine."""
    count = line_count(file)
    if count is None:
        return "file is not in the index"
    if start < 1 or end < start or end > count:
        return f"lines {start}-{end} do not exist (file has {count} lines)"
    if not any(f == file and start <= r_end and end >= r_start for f, r_start, r_end in received):
        return "range is not in the code the Explainer received"
    return None


def _level(total: int, dropped: int) -> Level:
    if total == 0 or dropped * 2 > total:
        return "low"
    return "high" if dropped == 0 else "medium"


def _sentence_before(answer: str, pos: int) -> str:
    """The sentence a marker ends: text from the previous sentence end up to the marker."""
    before = re.sub(r"[ \t]*" + MARKER.pattern, "", answer[:pos]).rstrip()
    body = before.rstrip(".!?:;, ")
    ends = list(SENTENCE_END.finditer(body))
    sentence = body[ends[-1].end():] if ends else body
    sentence = " ".join(sentence.split()).strip("-* ")
    if sentence.count("`") % 2:  # a backtick left over from a removed marker
        sentence = sentence.rstrip("` ").lstrip("` ")
    if len(sentence) > MAX_WHY_CHARS:
        sentence = sentence[: MAX_WHY_CHARS - 3] + "..."
    return sentence or "Cited in the answer."


def _strip_markers(answer: str, markers: set[str]) -> str:
    """Remove dropped markers (and the space before them) from the answer."""
    for marker in markers:
        answer = re.sub(r"[ \t]*" + re.escape(marker), "", answer)
    return answer
