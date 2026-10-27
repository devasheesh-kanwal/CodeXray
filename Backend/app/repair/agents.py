"""The repair variant of the Architect: picks at most 5 files for the fix.

Same name as the shared Architect, so events still say "architect".
"""

from pydantic import BaseModel, Field

from app.agents.base import PROMPTS_DIR
from app.agents.roster import Architect

MAX_FILES = 5


class RepairArchitectInput(BaseModel):
    issue: str
    failing_tests: list[str] = Field(default_factory=list)


class PickedFile(BaseModel):
    file: str
    reason: str


class RepairArchitectOutput(BaseModel):
    files: list[PickedFile] = Field(default_factory=list)
    summary: str


class RepairArchitect(Architect):
    input_schema = RepairArchitectInput
    output_schema = RepairArchitectOutput
    max_steps = 6
    max_output_tokens = 1500

    def system_prompt(self) -> str:
        if self.prompt_text is not None:
            return self.prompt_text
        return (PROMPTS_DIR / "repair_architect.md").read_text(encoding="utf-8")

    def summarize(self, output: RepairArchitectOutput) -> str:
        if not output.files:
            return "no files picked"
        return f"picked {len(output.files)} files: {', '.join(f.file for f in output.files[:MAX_FILES])}"
