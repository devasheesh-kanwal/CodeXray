"""Every error, whatever its cause, uses {"error": {"code", "message", "details"}}."""

import pytest
from fastapi.testclient import TestClient

from app.errors import ErrorResponse

# Endpoints still built only as mocks (health, LLM status, the repo/index
# endpoints and Q&A are real), with a valid request body where one is needed.
ENDPOINTS = [
    ("post", "/api/repos/r1/review", {"diff_text": "--- a/x\n+++ b/x\n"}),
    ("get", "/api/repos/r1/rules", None),
]
# Built in prompt 6: without mock mode these answer with real data (404 for unknown ids).
REPAIR_ENDPOINTS = [
    ("post", "/api/repos/r1/repair", {"issue": "Delete returns 500"}),
    ("get", "/api/repairs/run_x", None),
    ("get", "/api/repairs/run_x/events", None),
    ("post", "/api/repairs/run_x/approve", None),
    ("post", "/api/repairs/run_x/reject", None),
]


def assert_error(resp, status: int, code: str) -> ErrorResponse:
    assert resp.status_code == status, resp.text
    body = ErrorResponse.model_validate(resp.json())
    assert body.error.code == code
    assert body.error.message
    return body


def test_unknown_route_is_404(client):
    assert_error(client.get("/api/does-not-exist"), 404, "NOT_FOUND")


def test_wrong_method_is_405(client):
    assert_error(client.delete("/api/health"), 405, "METHOD_NOT_ALLOWED")


def test_invalid_body_is_422_with_field_details(client):
    body = assert_error(
        client.post("/api/repos/r1/ask", json={"question": ""}), 422, "VALIDATION_ERROR"
    )
    fields = [e["field"] for e in body.error.details["errors"]]
    assert "body.question" in fields


def test_missing_query_param_is_422(client):
    assert_error(client.get("/api/repos/r1/file"), 422, "VALIDATION_ERROR")


def test_unknown_repair_run_is_404(client):
    body = assert_error(client.get("/api/repairs/run_nope"), 404, "NOT_FOUND")
    assert body.error.details == {"run_id": "run_nope"}


def test_approve_before_awaiting_approval_is_409(client):
    run_id = client.post("/api/repos/r1/repair", json={"issue": "x"}).json()["run_id"]
    assert_error(client.post(f"/api/repairs/{run_id}/approve"), 409, "INVALID_STATE")


def test_unexpected_exception_is_500(mock_app):
    @mock_app.get("/api/boom")
    def boom():
        raise RuntimeError("secret internals")

    resp = TestClient(mock_app, raise_server_exceptions=False).get("/api/boom")
    body = assert_error(resp, 500, "INTERNAL_ERROR")
    assert "secret internals" not in resp.text
    assert body.error.details == {}


@pytest.mark.parametrize(("method", "url", "body"), ENDPOINTS)
def test_without_mock_mode_endpoints_are_501(real_client, method, url, body):
    resp = real_client.request(method, url, json=body)
    body = assert_error(resp, 501, "NOT_IMPLEMENTED")
    assert body.error.details["prompt"] in {"2", "3", "4", "5", "6"}


@pytest.mark.parametrize(("method", "url", "body"), REPAIR_ENDPOINTS)
def test_without_mock_mode_repair_endpoints_are_real(real_client, method, url, body):
    assert_error(real_client.request(method, url, json=body), 404, "NOT_FOUND")


def test_health_works_without_mock_mode(real_client):
    assert real_client.get("/api/health").status_code == 200
