"""The Q&A workflow end to end with a scripted fake LLM (sample repo, BM25 only)."""

import asyncio

import pytest

from app.errors import ApiError
from app.qa.citations import NOT_FOUND_ANSWER
from tests.conftest import parse_sse
from tests.llm.fakes import error, stream
from tests.qa.conftest import ARCHITECT_MODEL, EXPLAINER_MODEL, answer, read_file, search, select

FIND_USER = ("shop/services.py", 13, 17)


def test_answer_with_verified_citations(qa):
    qa.fake.on(ARCHITECT_MODEL, search("find user"), select(FIND_USER))
    qa.fake.on(EXPLAINER_MODEL, answer("find_user loads the user ", "[shop/services.py:13-17]."))

    result = qa.ask()

    assert not result.not_found
    assert result.answer == "find_user loads the user [shop/services.py:13-17]."
    assert [(c.file, c.start_line, c.end_line, c.why) for c in result.citations] == [
        ("shop/services.py", 13, 17, "find_user loads the user")]
    assert result.confidence == 0.9
    assert (result.provider, result.model, result.cached) == ("nvidia", EXPLAINER_MODEL, False)
    agents = [step.agent for step in result.agent_trace]
    assert agents.index("architect") < agents.index("explainer") < agents.index("citation_checker")


def test_works_in_bm25_only_mode(qa):
    qa.fake.on(ARCHITECT_MODEL, search("find user"), select(FIND_USER))
    qa.fake.on(EXPLAINER_MODEL, answer("It loads the user [shop/services.py:13-17]."))
    state = qa.run()
    assert state.artifacts["search"]["mode"] == "bm25_only"
    assert state.machine_state == "answered"
    assert state.artifacts["context"]["labels"] == ["[shop/services.py:13-17]"]


def test_low_best_score_is_not_found_and_explainer_never_called(qa):
    # "kubernetes" matches nothing, yet the Architect claims it found code
    qa.fake.on(ARCHITECT_MODEL, search("kubernetes"), select(FIND_USER))
    result = qa.ask("How is the kubernetes cluster deployed?")

    assert result.not_found and result.answer == NOT_FOUND_ANSWER
    assert result.citations == [] and result.confidence == 0.0
    assert EXPLAINER_MODEL not in qa.models_called()
    assert (result.provider, result.model) == ("groq", ARCHITECT_MODEL)


def test_not_found_answer_reports_cached_when_replayed(qa):
    # Same question twice: the second run replays the Architect's replies from the LLM cache.
    qa.fake.on(ARCHITECT_MODEL, search("kubernetes"), select(FIND_USER))
    first = qa.ask("How is the kubernetes cluster deployed?")
    second = qa.ask("How is the kubernetes cluster deployed?")
    assert first.not_found and second.not_found
    assert (first.cached, second.cached) == (False, True)


def test_architect_found_false_is_asked_again_not_replayed(qa):
    # A busy provider's fallback once said "nothing found"; asking again must reach a model,
    # not replay that verdict from the cache forever.
    qa.fake.on(ARCHITECT_MODEL, search("find user"), select(found=False), select(FIND_USER))
    qa.fake.on(EXPLAINER_MODEL, answer("find_user loads the user [shop/services.py:13-17]."))

    first = qa.ask()
    second = qa.ask()

    assert first.not_found and not second.not_found
    assert qa.models_called().count(ARCHITECT_MODEL) == 3  # the search step was replayed, the verdict was not


def test_step_limit_falls_back_to_a_final_request_without_tools(qa):
    # Six searches, a tool call even when asked for the final answer, then the answer once
    # no tools are offered at all.
    steps = [search("find user")] * 6
    qa.fake.on(ARCHITECT_MODEL, *steps, search("find user"), select(FIND_USER))
    qa.fake.on(EXPLAINER_MODEL, answer("find_user loads the user [shop/services.py:13-17]."))

    result = qa.ask()

    assert not result.not_found
    final_request = qa.fake.calls[7].body
    assert "tools" not in final_request  # the second final request offered no tools


def test_tool_call_instead_of_a_final_answer_at_the_step_limit_is_not_replayed(qa):
    # Both final requests get a tool call: not found. Asked again, the final request must
    # reach a model, not replay those tool calls from the cache.
    steps = [search("find user")] * 6
    qa.fake.on(ARCHITECT_MODEL, *steps, search("find user"), search("find user"), select(FIND_USER))
    qa.fake.on(EXPLAINER_MODEL, answer("find_user loads the user [shop/services.py:13-17]."))

    first = qa.ask()
    second = qa.ask()

    assert first.not_found and not second.not_found
    assert qa.models_called().count(ARCHITECT_MODEL) == 9  # 6 steps + 2 final requests, then 1 live final request


def test_explainer_not_found_is_asked_again_not_replayed(qa):
    qa.fake.on(ARCHITECT_MODEL, search("find user"), select(FIND_USER))
    qa.fake.on(EXPLAINER_MODEL, answer("NOT_FOUND"), answer("find_user loads the user [shop/services.py:13-17]."))

    first = qa.ask()
    second = qa.ask()

    assert first.not_found and not second.not_found
    assert second.citations and second.citations[0].file == "shop/services.py"


def test_explainer_asking_for_two_reads_at_once_never_leaks_the_request(qa):
    # Seen with Nemotron 550B: two tool requests in one reply. The first is run, then the answer.
    two_reads = stream(
        '{"action": "read_file", "args": {"path": "shop/services.py", "start": 13, "end": 17}}\n'
        '{"action": "read_file", "args": {"path": "shop/db.py", "start": 1, "end": 5}}'
    )
    qa.fake.on(ARCHITECT_MODEL, search("find user"), select(FIND_USER))
    qa.fake.on(EXPLAINER_MODEL, two_reads, answer("find_user loads the user [shop/services.py:13-17]."))

    result = qa.ask()

    assert '"action"' not in result.answer
    assert result.answer == "find_user loads the user [shop/services.py:13-17]."
    assert result.citations and result.citations[0].file == "shop/services.py"


def test_architect_found_false_is_not_found(qa):
    qa.fake.on(ARCHITECT_MODEL, search("find user"), select(found=False))
    assert qa.ask().not_found
    assert EXPLAINER_MODEL not in qa.models_called()


def test_architect_that_never_searched_cannot_pass_the_gate(qa):
    qa.fake.on(ARCHITECT_MODEL, select(FIND_USER))
    assert qa.ask().not_found
    assert EXPLAINER_MODEL not in qa.models_called()


def test_architect_that_never_finishes_is_not_found_not_an_error(qa):
    qa.fake.on(ARCHITECT_MODEL, search("login"))  # keeps calling tools, even at the step limit
    events = parse_sse("".join(collect(qa.service.ask_stream(qa.repo_id, "How does login work?"))))

    names = [name for name, _ in events]
    assert names[-2:] == ["final", "done"] and "error" not in names
    assert ("agent", {"agent": "architect", "status": "failed", "detail": None}) in events
    assert events[-2][1]["not_found"] is True
    assert EXPLAINER_MODEL not in qa.models_called()


def test_fake_marker_is_dropped_and_logged(qa):
    qa.fake.on(ARCHITECT_MODEL, search("find user"), select(FIND_USER))
    qa.fake.on(EXPLAINER_MODEL, answer("It loads the user [shop/services.py:13-17]. "
                                       "Then it checks a password [shop/auth.py:1-9]."))
    state = qa.run()
    result = qa.service.response(state)

    assert [c.file for c in result.citations] == ["shop/services.py"]
    assert "[shop/auth.py:1-9]" not in result.answer
    assert result.confidence == 0.6 and not result.not_found
    dropped = [e for e in state.events if e.kind == "citation_dropped"]
    assert len(dropped) == 1 and dropped[0].data["marker"] == "[shop/auth.py:1-9]"


def test_all_markers_fake_is_not_found(qa):
    qa.fake.on(ARCHITECT_MODEL, search("find user"), select(FIND_USER))
    qa.fake.on(EXPLAINER_MODEL, answer("It uses OAuth [shop/oauth.py:1-20] and JWT [shop/jwt.py:3-8]."))
    result = qa.ask()
    assert result.not_found and result.citations == [] and result.answer == NOT_FOUND_ANSWER


def test_not_found_line_from_explainer(qa):
    qa.fake.on(ARCHITECT_MODEL, search("find user"), select(FIND_USER))
    qa.fake.on(EXPLAINER_MODEL, answer("NOT_", "FOUND\nThe snippets do not show payments."))
    result = qa.ask("How are payments refunded?")
    assert result.not_found and result.answer == NOT_FOUND_ANSWER and result.citations == []


def test_marker_outside_the_sent_snippets_is_dropped(qa):
    # services.py:1-5 exists in the index, but only lines 13-17 were sent
    qa.fake.on(ARCHITECT_MODEL, search("find user"), select(FIND_USER))
    qa.fake.on(EXPLAINER_MODEL, answer("It loads the user [shop/services.py:13-17]. "
                                       "Imports come first [shop/services.py:1-5]."))
    result = qa.ask()
    assert [(c.start_line, c.end_line) for c in result.citations] == [(13, 17)]
    assert "[shop/services.py:1-5]" not in result.answer


def test_lines_the_explainer_read_count_as_received(qa):
    qa.fake.on(ARCHITECT_MODEL, search("find user"), select(FIND_USER))
    qa.fake.on(EXPLAINER_MODEL, read_file("shop/db.py", 8, 10),
               answer("find_user calls get_user_by_id [shop/services.py:13-17], "
                      "which reads a dict [shop/db.py:8-10]."))
    result = qa.ask()
    assert [c.file for c in result.citations] == ["shop/services.py", "shop/db.py"]
    assert result.confidence == 0.9
    assert "read_file" in [step.action for step in result.agent_trace if step.agent == "explainer"]


def test_unknown_ranges_from_the_architect_are_not_found(qa):
    qa.fake.on(ARCHITECT_MODEL, search("find user"), select(("shop/ghost.py", 1, 9)))
    assert qa.ask().not_found
    assert EXPLAINER_MODEL not in qa.models_called()


def test_streaming_order_agent_token_final_done(qa):
    qa.fake.on(ARCHITECT_MODEL, search("find user"), select(FIND_USER))
    qa.fake.on(EXPLAINER_MODEL, answer("It loads ", "the user ", "[shop/services.py:13-17]."))
    events = parse_sse("".join(collect(qa.service.ask_stream(qa.repo_id, "How is a user found?"))))

    names = [name for name, _ in events]
    assert names[-2:] == ["final", "done"]
    first_token = names.index("token")
    assert set(names[:first_token]) == {"agent"} and names[0] == "agent"
    assert set(names[first_token:-2]) == {"token"}
    assert events[0][1] == {"agent": "architect", "status": "running", "detail": "searching code"}
    assert "".join(data["text"] for name, data in events if name == "token") == \
        "It loads the user [shop/services.py:13-17]."
    final = events[-2][1]
    assert final["citations"][0]["file"] == "shop/services.py" and final["not_found"] is False
    assert set(final) == {"citations", "confidence", "not_found", "provider", "model", "agent_trace"}


def test_streaming_not_found_sends_one_token_with_the_message(qa):
    qa.fake.on(ARCHITECT_MODEL, search("find user"), select(FIND_USER))
    qa.fake.on(EXPLAINER_MODEL, answer("NOT_FOUND\nnothing about payments"))
    events = parse_sse("".join(collect(qa.service.ask_stream(qa.repo_id, "payments?"))))
    tokens = [data["text"] for name, data in events if name == "token"]
    assert tokens == [NOT_FOUND_ANSWER]
    assert events[-2][1]["not_found"] is True


def test_no_llm_available_is_503(qa):
    qa.fake.on(ARCHITECT_MODEL, error(400, "bad request"))
    with pytest.raises(ApiError) as raised:
        qa.ask()
    assert (raised.value.status_code, raised.value.code) == (503, "LLM_UNAVAILABLE")


def test_unknown_repo_is_404(qa):
    with pytest.raises(ApiError) as raised:
        asyncio.run(qa.service.ask("nope-123", "q"))
    assert raised.value.status_code == 404


def collect(agen) -> list[str]:
    async def go():
        return [item async for item in agen]

    return asyncio.run(go())
