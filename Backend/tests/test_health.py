from fastapi.testclient import TestClient

from app import __version__
from app.api.schemas.common import HealthResponse
from app.main import create_app
from tests.conftest import make_settings


def test_health_in_mock_mode(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = HealthResponse.model_validate(resp.json())
    assert body.status == "ok"
    assert body.version == __version__
    assert body.mock_mode is True
    assert body.demo_mode is False


def test_health_reflects_settings(tmp_path):
    app = create_app(make_settings(tmp_path, mock_mode=False, demo_mode=True))
    body = TestClient(app).get("/api/health").json()
    assert body["mock_mode"] is False
    assert body["demo_mode"] is True
