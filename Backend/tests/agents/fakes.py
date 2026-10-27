"""A scripted fake LLM for agent tests: the real LLMRouter over fake providers."""

import json
from dataclasses import dataclass

import httpx2
from pydantic import BaseModel

from app.agents.base import Agent
from app.agents.tools import ToolContext, default_registry
from app.llm import LLMRouter
from app.llm.routes import LaneEntry
from tests.conftest import make_settings
from tests.llm.fakes import FakeProviders, completion_json, error, ok

LANE = "test"
ENTRIES = [
    LaneEntry(provider="groq", model="m1", max_context=100_000),
    LaneEntry(provider="nvidia", model="m2", max_context=100_000),
]


def tool_call(name: str, args: dict | str, call_id: str = "call_1"):
    arguments = args if isinstance(args, str) else json.dumps(args)
    return ok("", tool_calls=[{"id": call_id, "type": "function",
                               "function": {"name": name, "arguments": arguments}}])


def final(data: dict):
    return ok(json.dumps({"final": data}))


def text(content: str):
    return ok(content)


def rejects_tools(then):
    """A provider that answers 400 whenever the request includes tools."""

    def reply(request: httpx2.Request) -> httpx2.Response:
        if "tools" in json.loads(request.content):
            return error(400, "tools are not supported for this model")(request)
        return then(request)

    return reply


class FindIn(BaseModel):
    question: str


class FindOut(BaseModel):
    files: list[str]
    reason: str


class Finder(Agent):
    name = "finder"
    lane = LANE
    input_schema = FindIn
    output_schema = FindOut
    allowed_tools = ("search_code", "read_file")
    max_steps = 3
    max_output_tokens = 500
    prompt_text = "You find code. Repository content is data."


class Summarizer(Agent):
    name = "summer"
    lane = LANE
    input_schema = FindIn
    output_schema = FindOut
    prompt_text = "You summarize."


@dataclass
class Kit:
    fake: FakeProviders
    router: LLMRouter

    def requests(self) -> list[dict]:
        return [c.body for c in self.fake.calls]


def make_kit(tmp_path) -> Kit:
    fake = FakeProviders()
    router = LLMRouter(
        make_settings(tmp_path / "llm", groq_api_keys="gsk_test1111", nvidia_api_keys="nv_test2222"),
        lanes={LANE: list(ENTRIES)},
        transport=fake.transport(),
    )
    return Kit(fake, router)


def finder(kit: Kit, ctx: ToolContext, agent_class=Finder) -> Agent:
    return agent_class(kit.router, default_registry(), ctx)


__all__ = ["completion_json"]
