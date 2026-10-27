"""The Q&A workflow: Architect -> not-found gate -> context -> Explainer -> Citation checker.

States (the Coordinator runs them in order; each handler returns the next one):
  architect     Architect agent picks the relevant code (tool loop, fast_small)
  gate          plain code: found=false or best_score < threshold -> not_found
  load_context  plain code: the chosen ranges as labelled snippets, within budget
  explain       Explainer agent streams a plain-text answer with [file:a-b] markers
  check         plain code: Citation checker keeps only provable markers
Final states: answered, not_found.

Handlers report progress to the API through on_event(name, payload): "agent"
and "token" SSE events. Everything else goes into RunState.
"""

import time
from collections.abc import Callable
from contextlib import asynccontextmanager

from pydantic import BaseModel

from app.agents.base import AgentOutputInvalid, AgentStepLimit
from app.agents.coordinator import Workflow
from app.agents.roster import Explainer
from app.agents.state import RunState
from app.agents.tools import MAX_READ_LINES, ToolContext, ToolRegistry, default_registry
from app.api.schemas.qa import AgentEvent, TokenEvent
from app.config import Settings
from app.errors import ApiError
from app.indexing.context import snippets_for_ranges
from app.indexing.service import IndexService
from app.llm import LLMResponse, LLMRouter
from app.qa.agents import QaArchitect
from app.qa.citations import NOT_FOUND_LINE, Range, check_citations

OnEvent = Callable[[str, BaseModel], None]


def ignore_event(name: str, payload: BaseModel) -> None:
    """on_event for /ask, which has no stream."""


class QaWorkflow(Workflow):
    kind = "qa"
    start = "architect"
    final_states = frozenset({"answered", "not_found"})

    def __init__(
        self,
        settings: Settings,
        index: IndexService,
        router: LLMRouter,
        tools: ToolRegistry | None = None,
        on_event: OnEvent = ignore_event,
    ) -> None:
        self.settings = settings
        self.index = index
        self.router = router
        self.tools = tools or default_registry()
        self.on_event = on_event

    def handlers(self):
        return {
            "architect": self.architect,
            "gate": self.gate,
            "load_context": self.load_context,
            "explain": self.explain,
            "check": self.check,
        }

    # ---------- states ----------

    async def architect(self, state: RunState) -> str:
        try:
            async with self._working("architect", "searching code"):
                agent = QaArchitect(self.router, self.tools, self._tool_context(state))
                output = await agent.run({"task": state.inputs["question"]}, state)
        except (AgentStepLimit, AgentOutputInvalid) as exc:
            # The Architect searched but could not settle on an answer: nothing usable found.
            state.artifacts["selected_code"] = {"found": False, "relevant": []}
            return self._not_found(state, f"Architect did not finish ({type(exc).__name__})")
        state.artifacts["selected_code"] = output.model_dump()
        return "gate"

    async def gate(self, state: RunState) -> str:
        """Plain code decides; the Architect's found=true alone is not enough."""
        selected = state.artifacts["selected_code"]
        search = state.artifacts.get("search") or {"best_score": 0.0, "mode": "none"}
        threshold = (self.settings.not_found_threshold_bm25 if search["mode"] == "bm25_only"
                     else self.settings.not_found_threshold)
        score = f"best_score {search['best_score']:.2f} (threshold {threshold}, {search['mode']})"
        if not selected["found"] or not selected["relevant"]:
            return self._not_found(state, f"Architect found no relevant code; {score}")
        if search["best_score"] < threshold:
            return self._not_found(state, f"search too weak: {score}")
        state.emit("agent_output", f"relevant code found; {score}", agent="coordinator")
        return "load_context"

    async def load_context(self, state: RunState) -> str:
        started = time.monotonic()
        ranges = [(r["file"], r["start_line"], r["end_line"])
                  for r in state.artifacts["selected_code"]["relevant"]]
        snippets = snippets_for_ranges(self._line_reader(state.repo_id), ranges,
                                       self.settings.qa_context_tokens)
        if not snippets:
            return self._not_found(state, "none of the selected ranges exist in the index")
        state.artifacts["context"] = {
            "labels": [s.label for s in snippets],
            "text": "\n\n".join(s.render() for s in snippets),
        }
        state.artifacts["received"] = [[s.file, s.start_line, s.end_line] for s in snippets]
        state.emit("agent_output", f"loaded {len(snippets)} snippets: {', '.join(s.label for s in snippets[:3])}",
                   agent="coordinator", ms=_ms(started))
        return "explain"

    async def explain(self, state: RunState) -> str:
        explainer = Explainer(self.router, self.tools, self._tool_context(state))
        question = {"question": state.inputs["question"], "context": state.artifacts["context"]["text"]}
        tokens = _NotFoundFilter(lambda text: self.on_event("token", TokenEvent(text=text)))
        async with self._working("explainer", "writing the answer"):
            async for piece in explainer.stream_text(question, state):
                if isinstance(piece, LLMResponse):
                    response = piece
                else:
                    tokens.feed(piece)
            tokens.flush()
        state.artifacts["answer"] = {
            "text": response.text, "provider": response.provider,
            "model": response.model, "cached": response.cached,
        }
        state.artifacts["received"] += _explainer_reads(state)
        return "check"

    async def check(self, state: RunState) -> str:
        started = time.monotonic()
        async with self._working("citation_checker", "verifying citations"):
            skeleton = self.index.skeleton(state.repo_id)

            def line_count(path: str) -> int | None:
                file = skeleton.file(path)
                return file.line_count if file else None

            received: list[Range] = [tuple(r) for r in state.artifacts["received"]]
            result = check_citations(state.artifacts["answer"]["text"], received, line_count)
            for dropped in result.dropped:
                state.emit("citation_dropped", f"dropped {dropped.marker}: {dropped.reason}",
                           agent="citation_checker", marker=dropped.marker, reason=dropped.reason)
            kept = result.markers_total - len(result.dropped)
            state.artifacts["check"] = {
                "answer": result.answer,
                "citations": [c.model_dump() for c in result.citations],
                "confidence": result.confidence,
                "level": result.level,
                "not_found": result.not_found,
                "markers_total": result.markers_total,
                "markers_dropped": len(result.dropped),
            }
            state.emit("agent_output",
                       f"{kept} of {result.markers_total} citation markers verified ({result.level})",
                       agent="citation_checker", ms=_ms(started))
        return "not_found" if result.not_found else "answered"

    # ---------- helpers ----------

    def _not_found(self, state: RunState, reason: str) -> str:
        state.artifacts["not_found_reason"] = reason
        state.emit("agent_output", f"not found: {reason}", agent="coordinator")
        return "not_found"

    def _tool_context(self, state: RunState) -> ToolContext:
        return ToolContext(index=self.index, repo_id=state.repo_id, state=state)

    def _line_reader(self, repo_id: str) -> Callable[[str], list[str]]:
        """file -> its lines, or [] for a file that is not indexed (read once per file)."""
        cache: dict[str, list[str]] = {}

        def read(path: str) -> list[str]:
            if path not in cache:
                try:
                    cache[path] = self.index.file_lines(repo_id, path)
                except ApiError:
                    cache[path] = []
            return cache[path]

        return read

    @asynccontextmanager
    async def _working(self, agent: str, detail: str):
        """'agent' events around one agent's work: running, then done or failed."""
        self.on_event("agent", AgentEvent(agent=agent, status="running", detail=detail))
        try:
            yield
        except BaseException:
            self.on_event("agent", AgentEvent(agent=agent, status="failed"))
            raise
        self.on_event("agent", AgentEvent(agent=agent, status="done"))


class _NotFoundFilter:
    """Pass tokens through, except a reply that starts with the NOT_FOUND line."""

    def __init__(self, send: Callable[[str], None]) -> None:
        self.send = send
        self.held = ""
        self.decided = False
        self.not_found = False

    def feed(self, text: str) -> None:
        if self.decided:
            if not self.not_found:
                self.send(text)
            return
        self.held += text
        start = self.held.lstrip()
        if start and not NOT_FOUND_LINE.startswith(start[: len(NOT_FOUND_LINE)]):
            self._decide(not_found=False)
        elif len(start) >= len(NOT_FOUND_LINE):
            self._decide(not_found=True)

    def flush(self) -> None:
        if not self.decided and self.held.strip():
            self._decide(not_found=False)

    def _decide(self, not_found: bool) -> None:
        self.decided, self.not_found = True, not_found
        if not not_found:
            self.send(self.held)


def _explainer_reads(state: RunState) -> list[list]:
    """Line ranges the Explainer read with read_file (successful calls only)."""
    reads, pending = [], None
    for event in state.events:
        if event.agent != "explainer":
            continue
        if event.kind == "tool_call" and event.data.get("tool") == "read_file":
            pending = event.data.get("args") or {}
        elif event.kind == "tool_result" and pending is not None:
            if event.data.get("ok") and pending.get("path"):
                start = int(pending.get("start") or 1)
                end = int(pending.get("end") or start + MAX_READ_LINES - 1)
                reads.append([str(pending["path"]).replace("\\", "/").strip("/"), start, end])
            pending = None
    return reads


def _ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)
