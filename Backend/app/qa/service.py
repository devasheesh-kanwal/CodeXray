"""QaService: runs the Q&A workflow for /ask (one JSON answer) and /ask/stream (SSE)."""

import asyncio
from collections.abc import AsyncIterator

from app.agents.coordinator import Coordinator
from app.agents.state import RunState
from app.agents.tools import ToolRegistry
from app.agents.trace import build_agent_trace
from app.api.schemas.common import Citation
from app.api.schemas.qa import AskResponse, FinalEvent, TokenEvent
from app.api.sse import sse_event
from app.config import Settings
from app.errors import ApiError
from app.indexing.service import IndexService
from app.llm import LLMRouter
from app.qa.citations import NOT_FOUND_ANSWER
from app.qa.workflow import OnEvent, QaWorkflow, ignore_event

# Errors that mean "no LLM could answer", by exception class name in RunState.stop_reason
LLM_UNAVAILABLE = ("AllProvidersFailed", "DemoCacheMiss", "LLMStreamError")


class QaService:
    def __init__(
        self,
        settings: Settings,
        index: IndexService,
        router: LLMRouter,
        tools: ToolRegistry | None = None,
    ) -> None:
        self.settings = settings
        self.index = index
        self.router = router
        self.tools = tools
        self.coordinator = Coordinator(settings.data_path / "runs")

    def check_ready(self, repo_id: str) -> None:
        """404 for an unknown repo, 409 if it is not indexed yet. Call before streaming."""
        stage = self.index.status(repo_id).stage
        if stage != "ready":
            raise ApiError(409, "INVALID_STATE", f"Repo is not ready for questions (stage: {stage})",
                           {"repo_id": repo_id, "stage": stage})

    async def run(self, repo_id: str, question: str, on_event: OnEvent = ignore_event) -> RunState:
        """Run the workflow to the end. The RunState holds the answer and every event."""
        workflow = QaWorkflow(self.settings, self.index, self.router, self.tools, on_event)
        state = self.coordinator.new_run(workflow, repo_id, {"question": question})
        return await self.coordinator.run(workflow, state)

    async def ask(self, repo_id: str, question: str) -> AskResponse:
        self.check_ready(repo_id)
        return self.response(await self.run(repo_id, question))

    async def ask_stream(self, repo_id: str, question: str) -> AsyncIterator[str]:
        """SSE: agent events and tokens while the run works, then final and done."""
        queue: asyncio.Queue = asyncio.Queue()

        async def run_then_close() -> RunState:
            try:
                return await self.run(repo_id, question, lambda name, data: queue.put_nowait((name, data)))
            finally:
                queue.put_nowait(None)

        task = asyncio.create_task(run_then_close())
        sent_tokens = False
        try:
            while (item := await queue.get()) is not None:
                name, data = item
                if name == "agent" and sent_tokens:
                    continue  # keep the order agent -> token -> final; final has the full trace
                sent_tokens = sent_tokens or name == "token"
                yield sse_event(name, data)
            answer = self.response(await task)
        finally:
            task.cancel()  # no-op when it is done; stops the run if the client left

        if answer.not_found and not sent_tokens:
            yield sse_event("token", TokenEvent(text=answer.answer))
        yield sse_event("final", FinalEvent(
            citations=answer.citations, confidence=answer.confidence, not_found=answer.not_found,
            provider=answer.provider, model=answer.model, agent_trace=answer.agent_trace or [],
        ))
        yield sse_event("done", {})

    def response(self, state: RunState) -> AskResponse:
        """The AskResponse for a finished run, or an ApiError if the run failed."""
        if state.status != "done":
            raise _run_error(state)
        meta = state.artifacts.get("answer") or _architect_model(state)
        check = state.artifacts.get("check")
        if check is None:  # the not-found gate stopped the run before the Explainer
            check = {"answer": NOT_FOUND_ANSWER, "citations": [], "confidence": 0.0, "not_found": True}
        return AskResponse(
            answer=check["answer"],
            citations=[Citation(**c) for c in check["citations"]],
            confidence=check["confidence"],
            not_found=check["not_found"],
            provider=meta["provider"],
            model=meta["model"],
            cached=meta["cached"],
            agent_trace=build_agent_trace(state),
        )


def _architect_model(state: RunState) -> dict:
    """Provider and model for answers the Explainer never wrote."""
    used = state.models_used.get("architect") or ["none/none"]
    provider, _, model = used[-1].partition("/")
    # Cached only if the Architect really answered and every one of its replies was a cache hit.
    cached = bool(state.models_used.get("architect")) and not state.uncached_calls.get("architect")
    return {"provider": provider, "model": model, "cached": cached}


def _run_error(state: RunState) -> ApiError:
    details = {"run_id": state.run_id}
    reason = state.stop_reason or ""
    if state.status == "stopped" or reason.split(":")[0] in LLM_UNAVAILABLE:
        return ApiError(503, "LLM_UNAVAILABLE", "No language model could answer right now. "
                        "Try again in a minute.", details)
    return ApiError(500, "INTERNAL_ERROR", "The Q&A run failed", details)
