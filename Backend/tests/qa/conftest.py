"""Q&A test kit: the sample repo indexed BM25-only, and a scripted fake LLM per lane."""

import asyncio
import json
from dataclasses import dataclass

import pytest

from app.api.schemas.qa import AskResponse
from app.llm import LLMRouter
from app.llm.routes import LaneEntry
from app.qa.service import QaService
from tests.agents.conftest import indexed  # noqa: F401  (fixture)
from tests.conftest import make_settings
from tests.llm.fakes import FakeProviders, ok, stream

ARCHITECT_MODEL = "arch-m"  # fast_small lane
EXPLAINER_MODEL = "expl-m"  # long_context lane


def search(query: str, call_id: str = "call_1"):
    """The Architect calls search_code (native tool call)."""
    arguments = json.dumps({"query": query})
    return ok("", tool_calls=[{"id": call_id, "type": "function",
                               "function": {"name": "search_code", "arguments": arguments}}])


def select(*ranges: tuple[str, int, int], found: bool = True):
    """The Architect's final answer."""
    relevant = [{"file": f, "start_line": s, "end_line": e, "reason": "relevant"} for f, s, e in ranges]
    return ok(json.dumps({"final": {"found": found, "relevant": relevant}}))


def answer(*chunks: str):
    """The Explainer's streamed reply."""
    return stream(*chunks)


def read_file(path: str, start: int, end: int):
    """The Explainer asks for read_file (JSON protocol, streamed)."""
    return stream(json.dumps({"action": "read_file", "args": {"path": path, "start": start, "end": end}}))


@dataclass
class QaKit:
    fake: FakeProviders
    service: QaService
    repo_id: str

    def ask(self, question: str = "How is a user found?") -> AskResponse:
        return asyncio.run(self.service.ask(self.repo_id, question))

    def run(self, question: str = "How is a user found?"):
        return asyncio.run(self.service.run(self.repo_id, question))

    def models_called(self) -> list[str]:
        return self.fake.models_called()


@pytest.fixture
def qa(indexed, tmp_path) -> QaKit:  # noqa: F811
    fake = FakeProviders()
    router = LLMRouter(
        make_settings(tmp_path / "llm", groq_api_keys="gsk_test1111", nvidia_api_keys="nv_test2222"),
        lanes={
            "fast_small": [LaneEntry(provider="groq", model=ARCHITECT_MODEL, max_context=100_000)],
            "long_context": [LaneEntry(provider="nvidia", model=EXPLAINER_MODEL, max_context=100_000)],
        },
        transport=fake.transport(),
    )
    service = QaService(indexed.service.settings, indexed.service, router)
    return QaKit(fake, service, indexed.repo_id)
