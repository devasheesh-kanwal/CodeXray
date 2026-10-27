"""The Q&A Architect and the plain-text Explainer: lanes, tools and prompts."""

from app.agents.roster import ROSTER, Architect
from app.agents.tools import default_registry
from app.llm.routes import load_routes
from app.qa.agents import QaArchitect
from tests.agents.test_roster import INJECTION_LINE


def test_qa_architect_spec():
    assert QaArchitect.name == "architect"  # same name in the agent trace
    assert QaArchitect.lane == "fast_small" and QaArchitect.lane in load_routes()
    assert QaArchitect.max_steps == 6
    assert QaArchitect.allowed_tools == ("search_code", "read_skeleton", "get_neighbors")
    assert set(QaArchitect.allowed_tools) <= set(default_registry().tools)
    fields = QaArchitect.output_schema.model_json_schema()["properties"]
    assert set(fields) == {"found", "relevant"}


def test_shared_architect_is_unchanged():
    assert ROSTER["architect"] is Architect
    assert Architect.lane == "long_context" and "read_file" in Architect.allowed_tools


def test_qa_architect_prompt():
    text = " ".join(QaArchitect(router=None).system_prompt().split())
    for heading in ("## Your one job", "## Tools", "## Output"):
        assert heading in text
    assert "retry with synonyms and likely function or variable names" in text
    assert "login -> authenticate, sign_in, session, token" in text
    assert "route -> service -> database" in text
    assert "plausibly relates to the question" in text and "let the Explainer decide" in text
    assert INJECTION_LINE in text


def test_explainer_writes_plain_text_with_not_found_line():
    explainer = ROSTER["explainer"]
    assert explainer.lane == "long_context" and explainer.max_steps == 3
    assert explainer.allowed_tools == ("read_file",)
    assert set(explainer.output_schema.model_json_schema()["properties"]) == {"text"}
    text = explainer(router=None).system_prompt()
    assert "`NOT_FOUND`" in text and "[app/auth.py:12-25]" in text
