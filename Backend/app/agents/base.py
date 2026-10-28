"""Base Agent: one job, one lane, one system prompt, typed input and output.

Without tools an agent makes one ask_json call. With tools it runs a loop: each
step the model either calls a tool or gives its final answer. Native tool
calling (OpenAI format) is used first; if the providers reject tools or the
model sends broken tool calls, the agent switches to a JSON protocol:
{"action": "<tool>", "args": {...}} or {"final": {...}}.

stream_text() is for agents whose answer is plain text (the Explainer): it
streams the answer, and tool calls before it use the same JSON protocol.
"""

import json
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, ClassVar

from pydantic import BaseModel, ValidationError

from app.agents.state import RunState
from app.agents.tools import ToolContext, ToolRegistry
from app.llm import AllProvidersFailed, LLMError, LLMResponse, LLMRouter
from app.llm.jsonout import strip_fences

PROMPTS_DIR = Path(__file__).parent / "prompts"
Message = dict[str, Any]


class AgentError(Exception):
    """An agent could not produce a valid output."""


class AgentStepLimit(AgentError):
    """max_steps reached and the final-answer request did not give a valid output."""


class AgentOutputInvalid(AgentError):
    """The final answer did not match the output schema, even after one retry."""


def parse_reply(text: str) -> tuple[str, Any]:
    """('tool', (name, args)) | ('final', data) | ('invalid', reason) for a text reply.

    Some models ask for several tools at once, one JSON object per line. Then the
    first request is used; the model sees its result and can ask for the next one.
    """
    body = strip_fences(text).strip()
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        try:
            data, _ = json.JSONDecoder().raw_decode(body)
        except json.JSONDecodeError:
            return "invalid", "your reply was not valid JSON"
        if not (isinstance(data, dict) and "action" in data):
            return "invalid", "your reply was not valid JSON"
    if not isinstance(data, dict):
        return "invalid", "your reply must be one JSON object"
    if "action" in data:
        return "tool", (str(data["action"]), data.get("args") or {})
    return "final", data["final"] if "final" in data else data


class Agent:
    name: ClassVar[str]
    lane: ClassVar[str]
    input_schema: ClassVar[type[BaseModel]]
    output_schema: ClassVar[type[BaseModel]]
    allowed_tools: ClassVar[tuple[str, ...]] = ()
    max_steps: ClassVar[int] = 6
    max_output_tokens: ClassVar[int] = 2000
    temperature: ClassVar[float] = 0.2
    prompt_text: ClassVar[str | None] = None  # tests can set this instead of a file

    def __init__(
        self,
        router: LLMRouter,
        tools: ToolRegistry | None = None,
        context: ToolContext | None = None,
    ) -> None:
        self.router = router
        self.tools = tools
        self.context = context

    def system_prompt(self) -> str:
        if self.prompt_text is not None:
            return self.prompt_text
        return (PROMPTS_DIR / f"{self.name}.md").read_text(encoding="utf-8")

    def summarize(self, output: BaseModel) -> str:
        """One line for the timeline; agents override this."""
        return output.model_dump_json()[:200]

    async def run(self, input: Any, state: RunState, exclude_models: list[str] | None = None):
        """Run the agent and return a validated output_schema instance."""
        data = self.input_schema.model_validate(input)
        state.emit("agent_started", f"{self.name} started", agent=self.name, step=0, lane=self.lane)
        try:
            if self.allowed_tools:
                output, step, ms = await self._tool_loop(data, state, exclude_models)
            else:
                output, step, ms = await self._single_call(data, state, exclude_models)
        except (AgentError, LLMError) as exc:
            state.emit("agent_error", f"{self.name} failed: {str(exc).splitlines()[0]}",
                       agent=self.name, recoverable=False)
            raise
        state.emit("agent_output", self.summarize(output), agent=self.name, step=step, ms=ms,
                   output=output.model_dump(mode="json"))
        return output

    # ---------- streamed plain text ----------

    async def stream_text(
        self, input: Any, state: RunState, exclude_models: list[str] | None = None
    ) -> AsyncIterator[str | LLMResponse]:
        """Stream a plain-text answer: text chunks, then the answer's LLMResponse.

        Before answering, the model may use its tools (at most max_steps - 1
        times) by replying with only {"action": "<tool>", "args": {...}}. Those
        replies are not streamed. output_schema has one field, `text`.
        """
        data = self.input_schema.model_validate(input)
        state.emit("agent_started", f"{self.name} started", agent=self.name, step=0, lane=self.lane)
        messages = [
            {"role": "system", "content": self._text_system_block()},
            {"role": "user", "content": data.model_dump_json(indent=1)},
        ]
        step = 0
        try:
            while True:
                step += 1
                started = time.monotonic()
                tools_left = bool(self.allowed_tools) and step < self.max_steps
                if self.allowed_tools and not tools_left:
                    messages.append({"role": "user", "content": "Do not call any more tools. "
                                     "Write your answer now as plain text."})
                held = tools_left  # hold back the reply's start while it may be a tool call
                parts: list[str] = []
                async for piece in self._stream_once(state, messages, exclude_models):
                    if isinstance(piece, LLMResponse):
                        response = piece
                    elif not held:
                        yield piece
                    else:
                        parts.append(piece)
                        if not _may_be_tool_call("".join(parts)):
                            yield "".join(parts)
                            held, parts = False, []
                reply = "".join(parts)
                if held:
                    kind, payload = parse_reply(reply)
                    if kind == "tool":
                        name, args = payload
                        result = await self._use_tool(state, step, name, args, started)
                        messages.append({"role": "assistant", "content": reply})
                        messages.append({"role": "user", "content": f"Result of {name}:\n{result}"})
                        continue
                    if reply:  # held back, but not a tool call after all
                        yield reply
                break
        except (AgentError, LLMError) as exc:
            state.emit("agent_error", f"{self.name} failed: {str(exc).splitlines()[0]}",
                       agent=self.name, recoverable=False)
            raise
        output = self.output_schema.model_validate({"text": response.text})
        state.emit("agent_output", self.summarize(output), agent=self.name, step=step,
                   ms=_ms(started), output=output.model_dump(mode="json"))
        yield response

    async def _stream_once(self, state: RunState, messages, exclude):
        state.check_budget()
        async for piece in self.router.stream(
            self.lane, messages, temperature=self.temperature,
            exclude_models=exclude, max_tokens=self.max_output_tokens,
            replay=self._replayable,
        ):
            if isinstance(piece, LLMResponse):
                self._account(state, piece)
            yield piece

    def _text_system_block(self) -> str:
        if not self.allowed_tools:
            return self.system_prompt()
        return "\n".join([
            self.system_prompt(), "", "## How to use a tool",
            self.tools.describe(self.allowed_tools), "",
            f"Before you answer you may call a tool up to {self.max_steps - 1} times. To call one, "
            'reply with ONLY one JSON object and nothing else: {"action": "<tool name>", "args": {...}}',
            "Otherwise reply with your answer as plain text.",
        ])

    # ---------- no tools ----------

    async def _single_call(self, data: BaseModel, state: RunState, exclude):
        state.check_budget()
        started = time.monotonic()
        messages = [
            {"role": "system", "content": self.system_prompt()},
            {"role": "user", "content": data.model_dump_json(indent=1)},
        ]
        output, response = await self.router.ask_json(
            self.lane, messages, self.output_schema, temperature=self.temperature,
            exclude_models=exclude, max_tokens=self.max_output_tokens,
        )
        self._account(state, response)
        return output, 1, _ms(started)

    # ---------- tool loop ----------

    async def _tool_loop(self, data: BaseModel, state: RunState, exclude):
        mode = "native"
        messages = [
            {"role": "system", "content": self._system_block(mode)},
            {"role": "user", "content": data.model_dump_json(indent=1)},
        ]
        retried_invalid = False
        step = 0
        while step < self.max_steps:
            step += 1
            started = time.monotonic()
            specs = self.tools.specs(self.allowed_tools) if mode == "native" else None
            try:
                response = await self._ask(state, messages, specs, exclude)
            except AllProvidersFailed as exc:
                if mode == "native" and _tools_rejected(exc):
                    mode, messages = self._switch_to_json(state, messages, step, "providers rejected tool calling")
                    step -= 1  # the failed request didn't use a step
                    continue
                raise

            if mode == "native" and response.tool_calls:
                calls = _parse_native_calls(response)
                if calls is None:
                    mode, messages = self._switch_to_json(state, messages, step, "model sent broken tool calls")
                    continue
                messages.append(_assistant_tool_message(response))
                for call_id, name, args in calls:
                    result = await self._use_tool(state, step, name, args, started)
                    messages.append({"role": "tool", "tool_call_id": call_id, "content": result})
                continue

            kind, payload = parse_reply(response.text)
            if kind == "tool":
                name, args = payload
                result = await self._use_tool(state, step, name, args, started)
                messages.append({"role": "assistant", "content": response.text})
                messages.append({"role": "user", "content": f"Result of {name}:\n{result}"})
                continue

            output, error = self._validate(kind, payload)
            if output is not None:
                return output, step, _ms(started)
            if retried_invalid:
                raise AgentOutputInvalid(f"{self.name}: {error}")
            retried_invalid = True
            messages.append({"role": "assistant", "content": response.text})
            messages.append({"role": "user", "content": f"That final answer is invalid: {error}\n"
                             'Reply again with {"final": <answer matching the schema>}.'})

        return await self._final_answer(state, messages, mode, exclude, step)

    async def _final_answer(self, state, messages, mode, exclude, step):
        """Step limit reached: ask for a final answer with what it has. A model that
        still calls a tool is asked once more with no tools offered (JSON protocol)."""
        started = time.monotonic()
        last_request = 2 if mode == "native" else 1
        for request in range(1, last_request + 1):
            final_messages = [*messages, {"role": "user", "content": (
                "You have used all your steps. Do not call any more tools. Reply now with only "
                '{"final": <answer matching the schema>} based on what you have found.')}]
            specs = self.tools.specs(self.allowed_tools) if mode == "native" else None
            response = await self._ask(state, final_messages, specs, exclude, final_only=True)
            if self._usable_final(response):
                output, _ = self._validate(*parse_reply(response.text))
                return output, step + request, _ms(started)
            if request < last_request:
                mode, messages = self._switch_to_json(state, messages, step, "model kept calling tools at the step limit")
        raise AgentStepLimit(f"{self.name} reached {self.max_steps} steps without a valid final answer")

    # ---------- helpers ----------

    async def _ask(self, state: RunState, messages, specs, exclude, final_only: bool = False) -> LLMResponse:
        """final_only: the request for a final answer, where another tool call is no use."""
        state.check_budget()
        response = await self.router.ask(
            self.lane, messages, temperature=self.temperature, tools=specs,
            exclude_models=exclude, max_tokens=self.max_output_tokens,
            accept=self._usable_final if final_only else self._usable, replay=self._replayable,
        )
        self._account(state, response)
        return response

    def _usable(self, response: LLMResponse) -> bool:
        """A reply the tool loop can use (a well-formed tool call or a valid final
        answer). Only these are cached, so a rejected reply is never replayed."""
        if response.tool_calls:
            return _parse_native_calls(response) is not None
        kind, payload = parse_reply(response.text)
        return kind == "tool" or self._validate(kind, payload)[0] is not None

    def _usable_final(self, response: LLMResponse) -> bool:
        """A valid final answer (the only usable reply once the steps are used up)."""
        if response.tool_calls:
            return False
        kind, payload = parse_reply(response.text)
        return kind != "tool" and self._validate(kind, payload)[0] is not None

    def _replayable(self, response: LLMResponse) -> bool:
        """Whether a cached reply may be reused. Agents return False for verdicts
        like "nothing found", which depend on which model answered (a busy
        provider's weaker fallback can miss the code): those are asked again live."""
        return True

    def _account(self, state: RunState, response: LLMResponse) -> None:
        state.charge(response.prompt_tokens, response.completion_tokens)
        state.record_model(self.name, response.provider, response.model, cached=response.cached)

    async def _use_tool(self, state, step, name, args, started) -> str:
        state.emit("tool_call", f"{name}({_short_args(args)})", agent=self.name, step=step,
                   tool=name, args=args if isinstance(args, dict) else {})
        result = await self.tools.call(name, args, self.context, self.allowed_tools, self.name)
        state.emit("tool_result", result.summary, agent=self.name, step=step, ms=_ms(started),
                   tool=name, ok=result.ok)
        return result.text

    def _validate(self, kind: str, payload: Any) -> tuple[BaseModel | None, str]:
        if kind == "invalid":
            return None, payload
        try:
            return self.output_schema.model_validate(payload), ""
        except ValidationError as exc:
            return None, str(exc)

    def _system_block(self, mode: str) -> str:
        schema = json.dumps(self.output_schema.model_json_schema())
        parts = [self.system_prompt(), "", "## Output",
                 f"Your final answer must match this JSON schema:\n{schema}", ""]
        if mode == "native":
            parts.append('Use the provided tools when you need them. When you are done, reply '
                         'with only {"final": <your answer>} and no other text.')
        else:
            parts += ["## Tools", self.tools.describe(self.allowed_tools), "",
                      "Reply with exactly one JSON object and nothing else:",
                      '- to call a tool: {"action": "<tool name>", "args": {...}}',
                      '- when you are done: {"final": <your answer>}']
        return "\n".join(parts)

    def _switch_to_json(self, state, messages, step, reason):
        state.emit("agent_error", f"{self.name}: {reason}; switching to the JSON tool protocol",
                   agent=self.name, step=step, recoverable=True)
        history = _as_json_history(messages[1:])
        return "json", [{"role": "system", "content": self._system_block("json")}, *history]


def _may_be_tool_call(text: str) -> bool:
    """A streamed reply that is empty so far or starts like JSON may still be a tool call."""
    start = text.lstrip()
    return start == "" or start.startswith(("{", "```"))


def _tools_rejected(exc: AllProvidersFailed) -> bool:
    """True if at least one model refused the request (400) and none failed otherwise."""
    outcomes = {a.outcome for a in exc.attempts}
    return "bad_request" in outcomes and outcomes <= {"bad_request", "skipped"}


def _parse_native_calls(response: LLMResponse) -> list[tuple[str, str, dict]] | None:
    """[(call_id, tool name, args)], or None if any call has broken arguments."""
    calls = []
    for tc in response.tool_calls:
        try:
            args = json.loads(tc.arguments or "{}")
        except json.JSONDecodeError:
            return None
        if not isinstance(args, dict) or not tc.name:
            return None
        calls.append((tc.id, tc.name, args))
    return calls


def _assistant_tool_message(response: LLMResponse) -> Message:
    calls = []
    for tc in response.tool_calls:
        call = {"id": tc.id, "type": "function",
                "function": {"name": tc.name, "arguments": tc.arguments}}
        if tc.extra_content:  # e.g. Gemini's thought_signature, required on the next turn
            call["extra_content"] = tc.extra_content
        calls.append(call)
    return {"role": "assistant", "content": response.text or None, "tool_calls": calls}


def _as_json_history(messages: list[Message]) -> list[Message]:
    """Rewrite native tool-call messages as plain text for the JSON protocol."""
    history: list[Message] = []
    names: dict[str, str] = {}
    for message in messages:
        if message.get("tool_calls"):
            for tc in message["tool_calls"]:
                names[tc["id"]] = tc["function"]["name"]
                action = {"action": tc["function"]["name"],
                          "args": json.loads(tc["function"]["arguments"] or "{}")}
                history.append({"role": "assistant", "content": json.dumps(action)})
        elif message["role"] == "tool":
            name = names.get(message["tool_call_id"], "tool")
            history.append({"role": "user", "content": f"Result of {name}:\n{message['content']}"})
        else:
            history.append(message)
    return history


def _short_args(args: Any) -> str:
    text = json.dumps(args, ensure_ascii=False) if isinstance(args, dict) else str(args)
    return text if len(text) <= 80 else text[:77] + "..."


def _ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)
