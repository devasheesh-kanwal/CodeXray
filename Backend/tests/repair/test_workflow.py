"""The repair team end to end: real git worktrees, real pytest runs, scripted LLM."""

import asyncio

import pytest

from app.errors import ApiError
from app.llm.routes import LaneEntry
from app.repair.workflow import approved_branch_name, branch_name, repro_path
from tests.llm.fakes import error
from tests.repair.conftest import (
    EDITS_TEST,
    FIX,
    LANES,
    REGRESSION,
    REPRO_IMPORT_ERROR,
    REPRO_OK,
    REPRO_PASSES,
    TARGET,
    architect_picks,
    diagnosis,
    git,
    make_kit,
    note,
    patch,
    review,
    writes_test,
)


def script_success(kit, code_model: str = "code-m", review_model: str = "review-m"):
    kit.fake.on("arch-m", architect_picks("inventory/stock.py", "tests/test_stock.py"))
    kit.fake.on(code_model, diagnosis("top_sellers slices one item short"), *patch(FIX))
    kit.fake.on(review_model, review())


def states(run) -> list[str]:
    return [e.state for e in run.events if e.kind == "state"]


# (a)
def test_correct_patch_reaches_awaiting_approval(kit):
    script_success(kit)
    state = kit.run()
    run = kit.service.snapshot(state.run_id)

    assert run.state == "AWAITING_APPROVAL" and run.attempt == 1
    assert states(run) == ["CREATED", "BASELINE", "PLANNING", "BRANCHED", "DIAGNOSING", "PATCHING",
                           "TESTING", "EVALUATING", "REVIEWING", "AWAITING_APPROVAL"]
    assert "+    return ranked[:n]" in run.diff
    assert run.root_cause == "top_sellers slices one item short"
    assert [c.name for c in run.eval.checks] == ["target_test_passes", "no_regressions", "lint_clean",
                                                 "no_test_files_changed", "patch_size"]
    assert all(c.passed for c in run.eval.checks)
    assert run.reviewer_notes.startswith("Risk: low. Verdict: approve")
    assert state.artifacts["files"] == ["inventory/stock.py"]  # the Architect's test file was dropped
    baseline = next(e for e in run.events if e.kind == "tests")
    assert baseline.data["failing"] == [TARGET] and baseline.data["passed"] == 1
    assert any(e.kind == "note" and "weaker" in e.message for e in run.events)  # no Docker here
    assert len(kit.worktrees()) == 2  # main + the run's worktree, kept for approval
    assert (kit.repo / "inventory" / "stock.py").read_text().count("n - 1") == 1  # main untouched


def test_approve_creates_the_approved_branch_and_leaves_main_alone(kit):
    script_success(kit)
    state = kit.run()
    main_head = git(kit.repo, "rev-parse", "main")

    run = kit.decide(state.run_id, approve=True)

    assert run.state == "MERGED" and run.events[-1].data["branch"] == approved_branch_name(state.run_id)
    fixed = git(kit.repo, "show", f"{approved_branch_name(state.run_id)}:inventory/stock.py")
    assert "return ranked[:n]" in fixed
    assert git(kit.repo, "rev-parse", "main") == main_head
    assert git(kit.repo, "rev-parse", "--abbrev-ref", "HEAD").strip() == "main"
    assert "n - 1" in (kit.repo / "inventory" / "stock.py").read_text()
    assert sorted(kit.branches()) == sorted(["main", approved_branch_name(state.run_id)])
    assert len(kit.worktrees()) == 1
    with pytest.raises(ApiError) as exc:
        kit.decide(state.run_id, approve=True)
    assert exc.value.status_code == 409


# (b)
def test_patch_touching_a_test_file_is_rejected_and_fails_the_attempt(kit):
    kit.fake.on("arch-m", architect_picks("inventory/stock.py"))
    kit.fake.on("code-m", diagnosis("the test expects too much"), *patch(EDITS_TEST),
                diagnosis("top_sellers slices one item short"), *patch(FIX, attempt=2))
    kit.fake.on("small-m", note("Hypothesis: the test is wrong. Patch edited the test. Refused."))
    kit.fake.on("review-m", review())
    state = kit.run()

    first = state.artifacts["attempts"][0]
    assert "write_patch rejected the patch: test files must never be edited" in first["reason"]
    assert "pear" in (kit.repo / "tests" / "test_stock.py").read_text()
    run = kit.service.snapshot(state.run_id)
    assert run.state == "AWAITING_APPROVAL" and run.attempt == 2
    assert "CLEANUP" in states(run)


def script_regressions(kit):
    kit.fake.on("arch-m", architect_picks("inventory/stock.py"))
    kit.fake.on("code-m", *[reply for n in (1, 2, 3) for reply in
                            (diagnosis(f"hypothesis {n}: off by one"), *patch(REGRESSION, n))])
    kit.fake.on("small-m", *[note(f"NOTE-{n}: the patch broke test_total_units") for n in (1, 2, 3)])
    kit.fake.on("review-m", review("approve", "Looks good to me!"))


# (c) and (f)
def test_regression_gets_a_note_then_retries_then_fails_after_3_attempts(kit):
    script_regressions(kit)
    state = kit.run()
    run = kit.service.snapshot(state.run_id)

    assert run.state == "FAILED" and run.attempt == 3
    assert states(run).count("DIAGNOSING") == 3 and states(run).count("CLEANUP") == 3
    assert [n["failure_note"] for n in state.artifacts["notes"]] == [
        f"NOTE-{n}: the patch broke test_total_units" for n in (1, 2, 3)]
    assert all("no_regressions" in a["reason"] for a in state.artifacts["attempts"])
    assert state.artifacts["failure_reason"] == "Gave up after 3 failed attempts."
    notes = [e for e in run.events if e.kind == "note" and "branch_deleted" in e.data]
    assert len(notes) == 3 and notes[0].data["failure_note"].startswith("NOTE-1")
    assert run.diff is None and run.root_cause is None
    # (f) cleanup: no worktrees, no CodeXray branches, nothing left in data/worktrees
    assert len(kit.worktrees()) == 1 and kit.branches() == ["main"]
    assert not any((kit.data_dir / "worktrees").iterdir())


# (d)
def test_second_debugger_input_contains_the_first_failure_note(kit):
    script_regressions(kit)
    kit.run()
    debugger_calls = kit.calls_by("Debugger")
    first_user, second_user = (calls["messages"][1]["content"] for calls in debugger_calls[:2])
    assert "NOTE-1" not in first_user
    assert "NOTE-1: the patch broke test_total_units" in second_user


# (e)
def test_reviewer_looks_good_never_overrides_a_failed_eval(kit):
    script_regressions(kit)
    state = kit.run()
    assert kit.service.snapshot(state.run_id).state == "FAILED"
    assert kit.calls_by("Reviewer") == []  # only a passed eval reaches the Reviewer
    assert state.artifacts.get("review") is None


# (f)
def test_reject_cleans_up_worktree_and_branch(kit):
    script_success(kit)
    state = kit.run()
    run = kit.decide(state.run_id, approve=False)
    assert run.state == "REJECTED"
    assert len(kit.worktrees()) == 1 and kit.branches() == ["main"]
    assert not git(kit.repo, "branch", "--list", branch_name(state.run_id)).strip()


# (g)
def test_reviewer_skips_the_model_repair_fell_back_to(tmp_path):
    lanes = {
        **LANES,
        "heavy_code": [LaneEntry(provider="groq", model="code-down", max_context=100_000),
                       LaneEntry(provider="groq", model="openai/gpt-oss-120b", max_context=100_000)],
        "reviewer": [LaneEntry(provider="groq", model="openai/gpt-oss-120b", max_context=100_000),
                     LaneEntry(provider="gemini", model="review-m", max_context=100_000)],
    }
    kit = make_kit(tmp_path, lanes)
    kit.fake.on("code-down", error(500, "down"))
    script_success(kit, code_model="openai/gpt-oss-120b")
    state = kit.run()

    assert state.models_used["repair"] == ["groq/openai/gpt-oss-120b"]
    assert state.models_used["reviewer"] == ["gemini/review-m"]
    assert kit.models_for("Reviewer") == ["review-m"]
    assert state.artifacts["review"]["excluded_models"] == ["groq/openai/gpt-oss-120b"]


# (h)
def test_second_concurrent_run_for_the_same_repo_is_409(kit):
    script_success(kit)

    async def go():
        first = kit.service.start(kit.repo_id, "bug", None)
        with pytest.raises(ApiError) as exc:
            kit.service.start(kit.repo_id, "another bug", None)
        await kit.service.wait(first.run_id)
        return first, exc.value

    first, exc = asyncio.run(go())
    assert exc.status_code == 409 and exc.code == "INVALID_STATE"
    assert exc.details == {"repo_id": kit.repo_id, "run_id": first.run_id}


# ---------- no failing test: the Test writer writes a reproduction test ----------


def script_repro_success(kit, *repro_replies):
    kit.fake.on("arch-m", architect_picks("inventory/stock.py"))
    kit.fake.on("code-m", *(repro_replies or writes_test(REPRO_OK)),
                diagnosis("top_sellers slices one item short"), *patch(FIX))
    kit.fake.on("review-m", review())


def test_repo_without_tests_gets_a_frozen_reproduction_test_then_approval(tmp_path):
    kit = make_kit(tmp_path, without_tests=True)
    script_repro_success(kit)
    state = kit.run()
    run = kit.service.snapshot(state.run_id)
    path = repro_path(state.run_id)

    assert run.state == "AWAITING_APPROVAL" and run.attempt == 1
    assert states(run) == ["CREATED", "BASELINE", "PLANNING", "BRANCHED", "REPRODUCING", "DIAGNOSING",
                           "PATCHING", "TESTING", "EVALUATING", "REVIEWING", "AWAITING_APPROVAL"]
    assert state.artifacts["repro"]["targets"] == [f"{path}::test_top_sellers_returns_two_items"]
    assert run.repro_test.path == path and "top_sellers" in run.repro_test.code
    checks = {c.name: c for c in run.eval.checks}
    assert checks["target_test_passes"].passed and checks["repro_test_unchanged"].passed
    assert path not in run.diff  # the test is committed on the branch, not part of the patch
    assert "test_top_sellers_returns_two_items" in kit.calls_by("Reviewer")[0]["messages"][1]["content"]
    assert not (kit.repo / path).exists()  # the user's checkout is untouched

    approved = kit.decide(state.run_id, approve=True).events[-1].data["branch"]
    assert "top_sellers" in git(kit.repo, "show", f"{approved}:{path}")
    assert "return ranked[:n]" in git(kit.repo, "show", f"{approved}:inventory/stock.py")


def test_existing_tests_that_all_pass_also_get_a_reproduction_test(kit):
    script_repro_success(kit)
    state = kit.run(test_command="pytest tests/test_stock.py::test_total_units")
    run = kit.service.snapshot(state.run_id)
    assert run.state == "AWAITING_APPROVAL" and "REPRODUCING" in states(run)
    checks = {c.name: c for c in run.eval.checks}
    assert checks["no_regressions"].passed  # test_total_units still runs on every attempt
    assert "tests/test_stock.py::test_total_units" in state.artifacts["baseline"]


def test_a_reproduction_test_that_passes_is_refused_with_feedback_then_retried(tmp_path):
    kit = make_kit(tmp_path, without_tests=True)
    script_repro_success(kit, *writes_test(REPRO_PASSES), *writes_test(REPRO_OK))
    state = kit.run()
    assert kit.service.snapshot(state.run_id).state == "AWAITING_APPROVAL"
    second = kit.calls_by("Test writer")[2]["messages"][1]["content"]  # 2 calls per try
    assert "passed on the unpatched code" in second


def test_a_reproduction_test_that_cannot_import_fails_the_run_after_two_tries(tmp_path):
    kit = make_kit(tmp_path, without_tests=True)
    kit.fake.on("arch-m", architect_picks("inventory/stock.py"))
    kit.fake.on("code-m", *writes_test(REPRO_IMPORT_ERROR), *writes_test(REPRO_IMPORT_ERROR))
    state = kit.run()
    run = kit.service.snapshot(state.run_id)

    assert run.state == "FAILED" and "DIAGNOSING" not in states(run)
    reason = state.artifacts["failure_reason"]
    assert reason.startswith("Could not write a test that reproduces the issue")
    assert "package_that_is_not_installed" in reason
    assert kit.calls_by("Debugger") == [] and kit.calls_by("Repair") == []
    assert len(kit.worktrees()) == 1 and kit.branches() == ["main"]


def test_baseline_that_cannot_run_still_fails_without_llm_calls(kit):
    state = kit.run(test_command="pytest tests/does_not_exist.py")
    run = kit.service.snapshot(state.run_id)
    assert run.state == "FAILED" and states(run) == ["CREATED", "BASELINE", "FAILED"]
    assert state.artifacts["failure_reason"].startswith("Baseline tests could not run")
    assert kit.fake.calls == []


# ---------- the Reviewer is required ----------


def test_reviewer_down_twice_fails_the_run_instead_of_reaching_approval(kit):
    kit.fake.on("arch-m", architect_picks("inventory/stock.py"))
    kit.fake.on("code-m", diagnosis("top_sellers slices one item short"), *patch(FIX))
    kit.fake.on("review-m", error(500, "down"), error(500, "down"))
    state = kit.run()
    run = kit.service.snapshot(state.run_id)

    assert run.state == "FAILED" and "AWAITING_APPROVAL" not in states(run)
    assert state.artifacts["failure_reason"].startswith("Reviewer unavailable after a retry")
    assert any(e.kind == "note" and "retrying" in e.message for e in run.events)
    assert len(kit.worktrees()) == 1 and kit.branches() == ["main"]


def test_reviewer_down_once_is_retried(kit):
    kit.fake.on("arch-m", architect_picks("inventory/stock.py"))
    kit.fake.on("code-m", diagnosis("top_sellers slices one item short"), *patch(FIX))
    kit.fake.on("review-m", error(500, "down"), review())
    state = kit.run()
    assert kit.service.snapshot(state.run_id).state == "AWAITING_APPROVAL"
    assert state.artifacts["review"]["verdict"] == "approve"


def test_test_command_must_run_pytest(kit):
    with pytest.raises(ApiError) as exc:
        kit.service.start(kit.repo_id, "bug", "rm -rf /")
    assert exc.value.status_code == 422
