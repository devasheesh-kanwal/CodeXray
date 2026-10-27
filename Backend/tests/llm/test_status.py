"""Startup model check and GET /api/llm/status with the real router."""

import asyncio

from fastapi.testclient import TestClient

from app.api.schemas.llm import LlmStatus
from app.main import create_app
from app.llm.state import MAX_RECENT_CALLS
from tests.conftest import make_settings
from tests.llm.fakes import LANE, error, make_router, user


def test_missing_model_is_warned_about_and_skipped(tmp_path, caplog):
    kit = make_router(tmp_path)
    kit.fake.model_lists = {
        "groq": ["other-model"],              # small-a missing
        "nvidia": ["mid-b"],
        "openrouter": ["models/big-c:free"],  # 'models/' prefix (Gemini style) is ignored
    }
    warnings = asyncio.run(kit.router.check_models())

    assert warnings == ["groq/small-a is not in groq's model list; skipping it"]
    assert "groq/small-a" in caplog.text
    response = asyncio.run(kit.router.ask(LANE, user("hi")))
    assert response.model == "mid-b"
    assert kit.fake.models_called() == ["mid-b"]


def test_failing_model_list_skips_nothing(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.model_lists = {"nvidia": ["mid-b"], "openrouter": ["big-c:free"]}  # groq -> 500
    warnings = asyncio.run(kit.router.check_models())
    assert len(warnings) == 1 and "Could not list groq models" in warnings[0]
    assert kit.router.state.missing_models == set()


def real_app(tmp_path, kit):
    app = create_app(make_settings(tmp_path / "app", mock_mode=False))
    app.state.llm_router = kit.router
    return app


def test_startup_runs_the_model_check(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.model_lists = {"groq": [], "nvidia": ["mid-b"], "openrouter": ["big-c:free"]}
    with TestClient(real_app(tmp_path, kit)):
        pass
    assert ("groq", "small-a") in kit.router.state.missing_models


def test_startup_check_is_skipped_in_demo_mode(tmp_path):
    kit = make_router(tmp_path)
    app = create_app(make_settings(tmp_path / "app", mock_mode=False, demo_mode=True))
    app.state.llm_router = kit.router
    with TestClient(app):
        pass
    assert kit.fake.calls == [] and kit.router.state.missing_models == set()


def test_status_endpoint_shows_states_and_calls(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", error(429, headers={"retry-after": "30"}))
    asyncio.run(kit.router.ask(LANE, user("hi")))

    body = TestClient(real_app(tmp_path, kit)).get("/api/llm/status").json()
    status = LlmStatus.model_validate(body)

    states = {p.name: p.state for p in status.providers}
    assert states == {
        "nvidia": "available", "groq": "cooldown", "gemini": "no_keys",
        "openrouter": "available", "deepseek": "no_keys",
    }
    groq = next(p for p in status.providers if p.name == "groq")
    assert groq.cooldown_until.timestamp() == kit.clock.now + 30
    calls = [(c.provider, c.ok, c.switch_reason is not None) for c in status.recent_calls]
    assert calls == [("groq", False, False), ("nvidia", True, True)]


def test_status_keeps_only_last_50_calls(tmp_path):
    kit = make_router(tmp_path)
    for i in range(MAX_RECENT_CALLS + 5):
        asyncio.run(kit.router.ask(LANE, user(f"q{i}")))
    body = TestClient(real_app(tmp_path, kit)).get("/api/llm/status").json()
    assert len(body["recent_calls"]) == MAX_RECENT_CALLS


def test_status_never_contains_keys(tmp_path):
    kit = make_router(tmp_path)
    asyncio.run(kit.router.ask(LANE, user("hi")))
    text = TestClient(real_app(tmp_path, kit)).get("/api/llm/status").text
    assert "gsk_" not in text and "nvapi" not in text
