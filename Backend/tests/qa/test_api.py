"""/ask and /ask/stream over HTTP with MOCK_MODE=false (fake LLM, sample repo)."""

import pytest
from fastapi.testclient import TestClient

from app.api.schemas.qa import AskResponse
from app.indexing.intake import RepoMeta, save_meta
from app.main import create_app
from tests.conftest import make_settings, parse_sse
from tests.llm.fakes import error
from tests.qa.conftest import ARCHITECT_MODEL, EXPLAINER_MODEL, answer, search, select

QUESTION = {"question": "How is a user found?"}


@pytest.fixture
def api(qa, tmp_path) -> TestClient:
    app = create_app(make_settings(tmp_path / "app", mock_mode=False))
    app.state.index_service = qa.service.index
    app.state.qa_service = qa.service
    return TestClient(app)


def script_answer(qa):
    qa.fake.on(ARCHITECT_MODEL, search("find user"), select(("shop/services.py", 13, 17)))
    qa.fake.on(EXPLAINER_MODEL, answer("It loads ", "the user [shop/services.py:13-17]."))


def test_ask_returns_real_data(api, qa):
    script_answer(qa)
    response = api.post(f"/api/repos/{qa.repo_id}/ask", json=QUESTION)
    assert response.status_code == 200, response.text
    body = AskResponse.model_validate(response.json())
    assert body.answer == "It loads the user [shop/services.py:13-17]."
    assert body.citations[0].file == "shop/services.py" and body.model == EXPLAINER_MODEL


def test_ask_stream_sends_agent_token_final_done(api, qa):
    script_answer(qa)
    response = api.post(f"/api/repos/{qa.repo_id}/ask/stream", json=QUESTION)
    assert response.headers["content-type"].startswith("text/event-stream")
    names = [name for name, _ in parse_sse(response.text)]
    first_token = names.index("token")
    assert set(names[:first_token]) == {"agent"}
    assert set(names[first_token:-2]) == {"token"}
    assert names[-2:] == ["final", "done"]


def test_unknown_repo_is_a_json_404_even_for_the_stream(api):
    for url in ["/api/repos/nope-1234/ask", "/api/repos/nope-1234/ask/stream"]:
        response = api.post(url, json=QUESTION)
        assert response.status_code == 404 and response.json()["error"]["code"] == "NOT_FOUND"


def test_repo_not_ready_is_409(api, qa):
    settings = qa.service.settings
    save_meta(settings.data_path, RepoMeta(repo_id="queued-1", name="q", source="/q",
                                           kind="local", root="/q"))
    response = api.post("/api/repos/queued-1/ask/stream", json=QUESTION)
    assert response.status_code == 409 and response.json()["error"]["code"] == "INVALID_STATE"


def test_empty_question_is_422(api, qa):
    response = api.post(f"/api/repos/{qa.repo_id}/ask", json={"question": ""})
    assert response.status_code == 422


def test_llm_failure_is_503_for_ask_and_an_error_event_for_the_stream(api, qa):
    qa.fake.on(ARCHITECT_MODEL, error(400, "bad request"))
    response = api.post(f"/api/repos/{qa.repo_id}/ask", json=QUESTION)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "LLM_UNAVAILABLE"
    assert "run_id" in response.json()["error"]["details"]

    events = parse_sse(api.post(f"/api/repos/{qa.repo_id}/ask/stream", json=QUESTION).text)
    assert events[-1][0] == "error" and events[-1][1]["code"] == "LLM_UNAVAILABLE"
    assert ("agent", {"agent": "architect", "status": "failed", "detail": None}) in events
