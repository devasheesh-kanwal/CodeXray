"""The 8 LLM agents: one job each, with typed input/output, a lane and allowed tools.

Plain-code agents (Coordinator, Citation checker, Static analyzer, Test runner,
Eval gate) are not here: they are ordinary functions in the workflows.
"""

from typing import Literal

from pydantic import BaseModel, Field

from app.agents.base import Agent
from app.llm import LLMResponse

Severity = Literal["critical", "high", "medium", "low"]
Category = Literal["bug", "security", "practice", "design"]


# ---------- Architect: find the code ----------


class ArchitectInput(BaseModel):
    task: str = Field(description="The question, or what a diff / issue is about")
    diff: str | None = None


class CodeLocation(BaseModel):
    file: str
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    symbol: str | None = None
    why: str


class ArchitectOutput(BaseModel):
    found: bool
    locations: list[CodeLocation] = Field(default_factory=list)
    summary: str


class Architect(Agent):
    name = "architect"
    lane = "long_context"
    input_schema = ArchitectInput
    output_schema = ArchitectOutput
    allowed_tools = ("search_code", "read_skeleton", "get_neighbors", "read_file")
    max_steps = 8
    max_output_tokens = 3000

    def summarize(self, output: ArchitectOutput) -> str:
        if not output.found:
            return "no relevant code found"
        files = sorted({loc.file for loc in output.locations})
        return f"selected {len(output.locations)} locations in {len(files)} files: {', '.join(files[:3])}"


# ---------- Explainer: answer with citations ----------


class ExplainerInput(BaseModel):
    question: str
    context: str = Field(description="Code snippets, each labelled [file:start-end]")


class ExplainerOutput(BaseModel):
    """Streamed with stream_text(); the Citation checker verifies it afterwards."""

    text: str = Field(description="Plain text with inline [file:start-end] markers, "
                                  "or a first line NOT_FOUND")


class Explainer(Agent):
    name = "explainer"
    lane = "long_context"
    input_schema = ExplainerInput
    output_schema = ExplainerOutput
    allowed_tools = ("read_file",)
    max_steps = 3  # up to 2 read_file calls, then the answer
    max_output_tokens = 3000

    def _replayable(self, response: LLMResponse) -> bool:
        """Never replay a cached NOT_FOUND reply: ask the model again."""
        return not response.text.lstrip().startswith("NOT_FOUND")

    def summarize(self, output: ExplainerOutput) -> str:
        if output.text.lstrip().startswith("NOT_FOUND"):
            return "the snippets do not answer the question (NOT_FOUND)"
        return f"wrote an answer ({len(output.text)} characters)"


# ---------- Code reviewer: find problems in a diff ----------


class CodeReviewerInput(BaseModel):
    diff: str
    context: str = Field(default="", description="Related code, labelled [file:start-end]")
    rules: list[str] = Field(default_factory=list, description="Active design rules")


class FindingDraft(BaseModel):
    category: Category
    severity: Severity
    file: str
    line: int = Field(ge=1)
    title: str
    explanation: str
    suggested_fix: str
    confidence: float = Field(ge=0, le=1)


class CodeReviewerOutput(BaseModel):
    findings: list[FindingDraft] = Field(default_factory=list)
    summary: str


class CodeReviewer(Agent):
    name = "code_reviewer"
    lane = "heavy_code"
    input_schema = CodeReviewerInput
    output_schema = CodeReviewerOutput
    allowed_tools = ("search_code", "get_neighbors", "read_file")
    max_steps = 6
    max_output_tokens = 4000

    def summarize(self, output: CodeReviewerOutput) -> str:
        return f"{len(output.findings)} findings"


# ---------- Debugger: root cause ----------


class DebuggerInput(BaseModel):
    run_id: str
    issue: str
    failing_tests: list[str] = Field(default_factory=list)
    files: list[str] = Field(default_factory=list, description="Files the Architect picked")
    failure_notes: list[str] = Field(default_factory=list, description="From earlier failed attempts")
    context: str = ""


class DebuggerOutput(BaseModel):
    root_cause: str
    file: str = Field(description="The source file that holds the bug")
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    evidence: list[str] = Field(description="Short quotes from the code or the test output")
    fix_plan: str


class Debugger(Agent):
    name = "debugger"
    lane = "heavy_code"
    input_schema = DebuggerInput
    output_schema = DebuggerOutput
    allowed_tools = ("search_code", "get_neighbors", "read_file", "read_test_output")
    max_steps = 6
    max_output_tokens = 2500

    def summarize(self, output: DebuggerOutput) -> str:
        return f"root cause in {output.file}:{output.start_line}-{output.end_line}: {output.root_cause[:120]}"


# ---------- Test writer: reproduction test when no test fails ----------


class TestWriterInput(BaseModel):
    __test__ = False  # not a pytest test class

    run_id: str
    issue: str
    files: list[str] = Field(default_factory=list, description="Files the Architect picked")
    test_file: str = Field(description="write_test writes this file at the repo root")
    feedback: str = Field("", description="Why CodeXray did not accept the previous test")


class TestWriterOutput(BaseModel):
    __test__ = False

    summary: str = Field(description="What the test checks, in one or two sentences")
    tests: list[str] = Field(default_factory=list, description="Names of the test functions")


class TestWriter(Agent):
    __test__ = False

    name = "test_writer"
    lane = "heavy_code"
    input_schema = TestWriterInput
    output_schema = TestWriterOutput
    allowed_tools = ("search_code", "read_skeleton", "read_file", "write_test")
    max_steps = 6
    max_output_tokens = 3000

    def summarize(self, output: TestWriterOutput) -> str:
        return f"wrote {', '.join(output.tests) or 'a test'}: {output.summary[:120]}"


# ---------- Repair: write the patch ----------


class RepairInput(BaseModel):
    run_id: str
    issue: str
    root_cause: str
    file: str
    start_line: int
    end_line: int
    fix_plan: str
    allowed_files: list[str] = Field(description="write_patch refuses any other file")


class RepairOutput(BaseModel):
    summary: str
    files_changed: list[str]


class Repair(Agent):
    name = "repair"
    lane = "heavy_code"
    input_schema = RepairInput
    output_schema = RepairOutput
    allowed_tools = ("read_file", "write_patch")
    max_steps = 6
    max_output_tokens = 4000

    def summarize(self, output: RepairOutput) -> str:
        return f"patched {', '.join(output.files_changed) or 'nothing'}"


# ---------- Reviewer: independent second opinion ----------


class ReviewerInput(BaseModel):
    run_id: str
    issue: str
    root_cause: str
    diff: str
    test_summary: str
    repro_test: str = Field("", description="The test CodeXray wrote to reproduce the issue, if any")


class ReviewerOutput(BaseModel):
    verdict: Literal["approve", "request_changes"]
    risk: Literal["low", "medium", "high"]
    notes: str
    concerns: list[str] = Field(default_factory=list)


class Reviewer(Agent):
    name = "reviewer"
    lane = "reviewer"
    input_schema = ReviewerInput
    output_schema = ReviewerOutput
    allowed_tools = ("read_file", "read_test_output")
    max_steps = 4
    max_output_tokens = 2000

    def summarize(self, output: ReviewerOutput) -> str:
        return f"verdict: {output.verdict}, risk: {output.risk}"


# ---------- Summarizer: failure note ----------


class SummarizerInput(BaseModel):
    issue: str
    attempt: int
    root_cause: str
    fix_plan: str = ""
    diff: str
    failed_checks: list[str] = Field(default_factory=list, description="Eval gate checks that failed")
    test_output: str


class SummarizerOutput(BaseModel):
    failure_note: str = Field(description="3-5 lines: hypothesis, patch idea, why it failed")


class Summarizer(Agent):
    name = "summarizer"
    lane = "fast_small"
    input_schema = SummarizerInput
    output_schema = SummarizerOutput
    max_output_tokens = 600

    def summarize(self, output: SummarizerOutput) -> str:
        return output.failure_note[:150]


ROSTER: dict[str, type[Agent]] = {
    agent.name: agent
    for agent in (Architect, Explainer, CodeReviewer, Debugger, TestWriter, Repair, Reviewer, Summarizer)
}
