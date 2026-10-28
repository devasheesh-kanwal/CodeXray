"""The Q&A variant of the Architect: cheaper lane, no read_file, its own output.

The shared Architect in app/agents/roster.py stays as it is for PR review and
repair. This one has the same name, so the agent trace still says "architect".
"""

from pydantic import BaseModel, Field

from app.agents.base import PROMPTS_DIR, parse_reply
from app.agents.roster import Architect
from app.llm import LLMResponse


class RelevantCode(BaseModel):
    file: str
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    reason: str


class QaArchitectOutput(BaseModel):
    found: bool
    relevant: list[RelevantCode] = Field(default_factory=list)


class QaArchitect(Architect):
    lane = "fast_small"
    output_schema = QaArchitectOutput
    allowed_tools = ("search_code", "read_skeleton", "get_neighbors")
    max_steps = 6
    max_output_tokens = 1500

    def system_prompt(self) -> str:
        if self.prompt_text is not None:
            return self.prompt_text
        return (PROMPTS_DIR / "qa_architect.md").read_text(encoding="utf-8")

    def _replayable(self, response: LLMResponse) -> bool:
        """Never replay a cached "found nothing" verdict: ask the model again."""
        if response.tool_calls:
            return True
        output, _ = self._validate(*parse_reply(response.text))
        return not (isinstance(output, QaArchitectOutput) and (not output.found or not output.relevant))

    def summarize(self, output: QaArchitectOutput) -> str:
        if not output.found or not output.relevant:
            return "no relevant code found"
        files = list(dict.fromkeys(r.file for r in output.relevant))
        return f"selected {len(output.relevant)} ranges in {len(files)} files: {', '.join(files[:3])}"
