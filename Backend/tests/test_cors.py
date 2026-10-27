from tests.conftest import ORIGIN


def test_preflight_from_frontend_origin_is_allowed(client):
    resp = client.options(
        "/api/repos/r/ask",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert resp.status_code == 200
    assert resp.headers["access-control-allow-origin"] == ORIGIN


def test_request_from_frontend_origin_gets_cors_header(client):
    resp = client.get("/api/health", headers={"Origin": ORIGIN})
    assert resp.headers["access-control-allow-origin"] == ORIGIN


def test_other_origin_gets_no_cors_header(client):
    resp = client.get("/api/health", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in resp.headers


def test_preflight_from_other_origin_is_rejected(client):
    resp = client.options(
        "/api/health",
        headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert resp.status_code == 400
    assert "access-control-allow-origin" not in resp.headers
