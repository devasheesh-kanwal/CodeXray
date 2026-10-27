"""SSE streams: /ask/stream and the mock repair run."""

import re

from app.api.schemas.qa import AgentEvent, FinalEvent, TokenEvent
from app.api.schemas.repair import RepairEvent, RepairRun
from app.mocks.loader import get_fixture
from tests.conftest import parse_sse

MARKER = re.compile(r"\[([^\[\]:]+):(\d+)-(\d+)\]")


# --- /ask/stream ---


def test_ask_stream_event_order_and_payloads(client):
    resp = client.post("/api/repos/r1/ask/stream", json={"question": "How does auth work?"})
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")

    events = parse_sse(resp.text)
    names = [name for name, _ in events]
    assert names[:2] == ["agent", "agent"]
    assert names[-2:] == ["final", "done"]
    assert set(names[2:-2]) == {"token"}

    for name, data in events:
        if name == "agent":
            AgentEvent.model_validate(data)
        elif name == "token":
            TokenEvent.model_validate(data)


def test_ask_stream_tokens_carry_three_markers_matching_final_citations(client):
    events = parse_sse(
        client.post("/api/repos/r1/ask/stream", json={"question": "q"}).text
    )
    answer = "".join(data["text"] for name, data in events if name == "token")
    assert answer == get_fixture("ask").answer

    final = FinalEvent.model_validate(events[-2][1])
    markers = {(f, int(s), int(e)) for f, s, e in MARKER.findall(answer)}
    assert len(MARKER.findall(answer)) == 3
    assert markers == {(c.file, c.start_line, c.end_line) for c in final.citations}
    assert final.agent_trace


def test_ask_stream_validates_input_before_streaming(client):
    resp = client.post("/api/repos/r1/ask/stream", json={})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


# --- mock repair run ---

EXPECTED_STATES = [
    "CREATED", "BASELINE", "PLANNING", "BRANCHED",
    "DIAGNOSING", "PATCHING", "TESTING", "CLEANUP",
    "DIAGNOSING", "PATCHING", "TESTING", "EVALUATING", "REVIEWING",
    "AWAITING_APPROVAL",
]  # fmt: skip


def start_run(client, issue="Deleting a missing todo returns 500") -> str:
    resp = client.post("/api/repos/r1/repair", json={"issue": issue})
    assert resp.status_code == 202
    return resp.json()["run_id"]


def get_run(client, run_id) -> RepairRun:
    resp = client.get(f"/api/repairs/{run_id}")
    assert resp.status_code == 200
    return RepairRun.model_validate(resp.json())


def test_repair_script_takes_about_twenty_seconds():
    steps = get_fixture("repair_script").steps
    assert 15 <= steps[-1].at_s <= 25
    assert [s.at_s for s in steps] == sorted(s.at_s for s in steps)


def test_new_run_starts_in_created_with_the_issue(client):
    run = get_run(client, start_run(client, "my issue"))
    assert run.state == "CREATED"
    assert run.attempt == 1
    assert run.events[0].data["issue"] == "my issue"
    assert run.diff is None and run.root_cause is None


def test_failed_attempt_is_cleaned_up_before_attempt_two(client, clock):
    run_id = start_run(client)

    clock.advance(8.2)
    run = get_run(client, run_id)
    assert (run.state, run.attempt) == ("TESTING", 1)
    assert run.diff and "app/models.py" in run.diff

    clock.advance(1.0)
    run = get_run(client, run_id)
    assert (run.state, run.attempt) == ("CLEANUP", 1)
    assert run.diff is None and run.root_cause is None

    clock.advance(1.5)
    run = get_run(client, run_id)
    assert (run.state, run.attempt) == ("DIAGNOSING", 2)


def test_events_stream_walks_every_state_to_awaiting_approval(client):
    run_id = start_run(client)
    resp = client.get(f"/api/repairs/{run_id}/events")
    assert resp.status_code == 200
    events = parse_sse(resp.text)

    assert events[-1] == ("done", {"state": "AWAITING_APPROVAL"})
    repair_events = [RepairEvent.model_validate(d) for n, d in events[:-1]]
    assert all(n == "repair_event" for n, _ in events[:-1])
    assert [e.state for e in repair_events] == EXPECTED_STATES
    assert [e.attempt for e in repair_events].count(2) == 6


def test_finished_run_has_root_cause_diff_eval_and_notes(client, clock):
    run_id = start_run(client)
    clock.advance(30)
    run = get_run(client, run_id)
    assert run.state == "AWAITING_APPROVAL"
    assert (run.attempt, run.max_attempts) == (2, 3)
    assert "fetchone" in run.root_cause
    assert "app/routes.py" in run.diff
    assert run.eval and all(check.passed for check in run.eval.checks)
    assert run.reviewer_notes


def test_approve_merges_and_cannot_be_repeated(client, clock):
    run_id = start_run(client)
    clock.advance(30)
    resp = client.post(f"/api/repairs/{run_id}/approve")
    assert resp.status_code == 200
    assert RepairRun.model_validate(resp.json()).state == "MERGED"
    assert client.post(f"/api/repairs/{run_id}/approve").status_code == 409
    assert client.post(f"/api/repairs/{run_id}/reject").status_code == 409

    events = parse_sse(client.get(f"/api/repairs/{run_id}/events").text)
    assert events[-1] == ("done", {"state": "MERGED"})


def test_reject_moves_run_to_rejected(client, clock):
    run_id = start_run(client)
    clock.advance(30)
    resp = client.post(f"/api/repairs/{run_id}/reject")
    assert resp.json()["state"] == "REJECTED"


def test_events_for_unknown_run_is_json_404(client):
    resp = client.get("/api/repairs/run_nope/events")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"
