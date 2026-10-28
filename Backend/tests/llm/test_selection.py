"""Picking a model (tried first everywhere, falls back if it fails) and extra providers from .env."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.config import ExtraProvider
from app.llm.routes import LaneEntry, add_extra_models
from tests.llm.fakes import ENTRIES, LANE, error, make_router, ok, user


def test_picked_model_is_tried_first(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("mid-b", ok("from b"))
    kit.router.select("nvidia/mid-b")
    response = asyncio.run(kit.router.ask(LANE, user("q")))
    assert response.text == "from b"
    assert kit.fake.models_called() == ["mid-b"]


def test_picked_model_that_fails_falls_back_to_the_lane(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("mid-b", error(429))
    kit.fake.on("small-a", ok("from a"))
    kit.router.select("nvidia/mid-b")
    response = asyncio.run(kit.router.ask(LANE, user("q")))
    assert response.text == "from a"
    assert kit.fake.models_called() == ["mid-b", "small-a"]


def test_picked_model_is_used_in_lanes_that_do_not_list_it(tmp_path):
    lanes = {LANE: list(ENTRIES), "other": [ENTRIES[0]]}
    kit = make_router(tmp_path)
    kit.router.lanes = lanes
    kit.fake.on("big-c:free", ok("from c"))
    kit.router.select("openrouter/big-c:free")
    assert asyncio.run(kit.router.ask("other", user("q"))).text == "from c"


def test_selection_is_remembered_across_restarts(tmp_path):
    make_router(tmp_path).router.select("nvidia/mid-b")
    assert make_router(tmp_path).router.selected == "nvidia/mid-b"
    make_router(tmp_path).router.select(None)
    assert make_router(tmp_path).router.selected is None


def test_unknown_model_cannot_be_picked(tmp_path):
    kit = make_router(tmp_path)
    with pytest.raises(ValueError, match="Unknown model"):
        kit.router.select("groq/not-a-model")


def test_answers_cached_from_another_model_are_not_served_to_the_picked_one(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", ok("from a"))
    kit.fake.on("mid-b", ok("from b"))
    asyncio.run(kit.router.ask(LANE, user("q")))  # small-a answers, cached
    kit.router.select("nvidia/mid-b")
    response = asyncio.run(kit.router.ask(LANE, user("q")))
    assert response.text == "from b" and not response.cached


def test_models_lists_every_model_with_its_state(tmp_path):
    kit = make_router(tmp_path, openrouter_api_keys="")
    kit.fake.on("small-a", error(429, headers={"retry-after": "30"}), ok("a"))
    asyncio.run(kit.router.ask(LANE, user("q")))
    kit.router.select("nvidia/mid-b")

    result = kit.router.models()
    states = {m.id: m.state for m in result.models}
    assert (result.mode, result.selected) == ("manual", "nvidia/mid-b")
    assert states == {"groq/small-a": "cooldown", "nvidia/mid-b": "available", "openrouter/big-c:free": "no_keys"}
    assert next(m for m in result.models if m.id == "groq/small-a").cooldown_until is not None


def test_auto_mode_sticks_with_the_replacement_for_a_while(tmp_path):
    kit = make_router(tmp_path)
    kit.fake.on("small-a", error(429, headers={"retry-after": "5"}), ok("a again"))
    kit.fake.on("mid-b", ok("b"))
    asyncio.run(kit.router.ask(LANE, user("one")))  # a fails, b answers
    kit.clock.advance(10)  # a has cooled down
    asyncio.run(kit.router.ask(LANE, user("two")))
    assert kit.fake.models_called() == ["small-a", "mid-b", "mid-b"]  # no flip back yet


def test_extra_provider_models_join_the_lanes_and_can_be_picked(tmp_path, monkeypatch):
    monkeypatch.setenv("TOGETHER_BASE_URL", "https://api.together.xyz/v1")
    monkeypatch.setenv("TOGETHER_API_KEYS", "tk_1111,tk_2222")
    monkeypatch.setenv("TOGETHER_MODELS", "llama-3.3-70b@131072,qwen-coder")
    kit = make_router(tmp_path, extra_providers="together")

    labels = [e.label for e in kit.router.lanes[LANE]]
    assert labels[-2:] == ["together/llama-3.3-70b", "together/qwen-coder"]  # last fallbacks
    assert kit.router.base_urls["together"] == "https://api.together.xyz/v1"
    assert len(kit.router.keys["together"].active()) == 2
    assert kit.router.catalog()["together/qwen-coder"].max_context == 32768
    kit.router.select("together/llama-3.3-70b")
    assert kit.router.selected == "together/llama-3.3-70b"


def test_extra_provider_lanes_limit_where_its_models_go():
    extra = ExtraProvider("together", "https://x.test/v1", [], [("m", 1000)], ["b"])
    lanes = add_extra_models({"a": [ENTRIES[0]], "b": [ENTRIES[1]]}, [extra])
    assert [e.label for e in lanes["a"]] == ["groq/small-a"]
    assert [e.label for e in lanes["b"]] == ["nvidia/mid-b", "together/m"]
    with pytest.raises(ValueError, match="unknown lane"):
        add_extra_models({"a": []}, [ExtraProvider("together", "https://x.test/v1", [], [("m", 1)], ["zzz"])])


@pytest.mark.parametrize(
    ("env", "problem"),
    [
        ({"TOGETHER_MODELS": "m"}, "TOGETHER_BASE_URL"),
        ({"TOGETHER_BASE_URL": "https://x.test/v1"}, "TOGETHER_MODELS must list"),
        ({"TOGETHER_BASE_URL": "https://x.test/v1", "TOGETHER_MODELS": "m@lots"}, "<model>@<max context"),
    ],
)
def test_incomplete_extra_provider_is_a_clear_error(tmp_path, env, problem):
    from tests.conftest import make_settings

    settings = make_settings(tmp_path, extra_providers="together")
    with pytest.raises(ValueError, match=problem):
        settings.extra_provider_configs(env)


def test_builtin_names_cannot_be_extra_providers(tmp_path):
    from tests.conftest import make_settings

    with pytest.raises(ValueError, match="built in"):
        make_settings(tmp_path, extra_providers="groq").extra_provider_configs({})


# ---------- API (mock mode) ----------


def test_mock_models_and_selection(client: TestClient):
    models = client.get("/api/llm/models").json()
    assert models["mode"] == "auto" and models["models"]
    picked = models["models"][0]["id"]

    after = client.put("/api/llm/selection", json={"model": picked}).json()
    assert (after["mode"], after["selected"]) == ("manual", picked)
    assert client.get("/api/llm/models").json()["selected"] == picked
    assert client.put("/api/llm/selection", json={"model": None}).json()["mode"] == "auto"


def test_selecting_an_unknown_model_is_422(client: TestClient):
    resp = client.put("/api/llm/selection", json={"model": "nope/nope"})
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_lane_entry_accepts_any_provider_name():
    assert LaneEntry(provider="together", model="m", max_context=10).label == "together/m"
