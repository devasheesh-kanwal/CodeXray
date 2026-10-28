EXPECTED_OPERATIONS = {
    ("get", "/api/health"),
    ("get", "/api/repos"),
    ("post", "/api/repos"),
    ("get", "/api/repos/{repo_id}/status"),
    ("get", "/api/repos/{repo_id}/tree"),
    ("get", "/api/repos/{repo_id}/graph"),
    ("get", "/api/repos/{repo_id}/file"),
    ("post", "/api/repos/{repo_id}/ask"),
    ("post", "/api/repos/{repo_id}/ask/stream"),
    ("post", "/api/repos/{repo_id}/review"),
    ("get", "/api/repos/{repo_id}/rules"),
    ("post", "/api/repos/{repo_id}/repair"),
    ("get", "/api/repairs/{run_id}"),
    ("get", "/api/repairs/{run_id}/events"),
    ("post", "/api/repairs/{run_id}/approve"),
    ("post", "/api/repairs/{run_id}/reject"),
    ("get", "/api/llm/status"),
    ("get", "/api/llm/models"),
    ("put", "/api/llm/selection"),
    ("get", "/api/embeddings"),
    ("put", "/api/embeddings/selection"),
}


def test_openapi_lists_every_endpoint(client):
    paths = client.get("/openapi.json").json()["paths"]
    operations = {(method, path) for path, ops in paths.items() for method in ops}
    assert operations == EXPECTED_OPERATIONS


def test_sse_endpoints_are_documented_as_event_streams(client):
    paths = client.get("/openapi.json").json()["paths"]
    for path, method in [
        ("/api/repos/{repo_id}/ask/stream", "post"),
        ("/api/repairs/{run_id}/events", "get"),
    ]:
        content = paths[path][method]["responses"]["200"]["content"]
        assert "text/event-stream" in content


def test_swagger_ui_is_served(client):
    resp = client.get("/docs")
    assert resp.status_code == 200
    assert "swagger-ui" in resp.text.lower()
