"""Shared test fixtures. Tests never read .env files, so real keys are never loaded."""

import json
import os

# app.main builds a module-level app on import; give it a value when no .env exists.
os.environ.setdefault("FRONTEND_ORIGIN", "http://localhost:5173")

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.mocks import streams  # noqa: E402
from app.mocks.repair_sim import MockRepairStore  # noqa: E402

ORIGIN = "http://localhost:5173"


class FakeClock:
    """A clock that only moves when told to."""

    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def make_settings(tmp_path, **overrides) -> Settings:
    values = {"frontend_origin": ORIGIN, "mock_mode": True, "data_dir": tmp_path}
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.fixture
def clock(monkeypatch) -> FakeClock:
    """Fake clock; mock streams advance it instead of sleeping."""
    fake = FakeClock()

    async def fast_pause(seconds: float) -> None:
        fake.advance(seconds)

    monkeypatch.setattr(streams, "pause", fast_pause)
    return fake


@pytest.fixture
def mock_app(tmp_path, clock) -> FastAPI:
    app = create_app(make_settings(tmp_path))
    app.state.repair_runs = MockRepairStore(clock=clock)
    return app


@pytest.fixture
def client(mock_app) -> TestClient:
    return TestClient(mock_app)


@pytest.fixture
def real_client(tmp_path) -> TestClient:
    """MOCK_MODE=false: everything except health is not implemented yet."""
    return TestClient(create_app(make_settings(tmp_path, mock_mode=False)))


def parse_sse(body: str) -> list[tuple[str, dict]]:
    """Split an SSE body into (event name, JSON data) pairs."""
    events = []
    for block in body.strip().split("\n\n"):
        name, data = "", ""
        for line in block.splitlines():
            if line.startswith("event: "):
                name = line.removeprefix("event: ")
            elif line.startswith("data: "):
                data = line.removeprefix("data: ")
        events.append((name, json.loads(data)))
    return events
