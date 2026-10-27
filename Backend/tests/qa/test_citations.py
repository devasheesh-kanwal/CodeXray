"""Citation checker: markers, why-sentences, confidence and not_found."""

from app.qa.citations import NOT_FOUND_ANSWER, check_citations

FILES = {"shop/api.py": 20, "shop/db.py": 14}
RECEIVED = [("shop/api.py", 1, 20), ("shop/db.py", 5, 10)]


def check(answer: str, received=RECEIVED):
    return check_citations(answer, received, FILES.get)


def test_verified_markers_become_citations_with_their_sentence():
    result = check("Users are loaded by get_user [shop/api.py:15-20]. "
                   "It reads the row from SQLite [shop/db.py:6-9].")
    assert [(c.file, c.start_line, c.end_line) for c in result.citations] == [
        ("shop/api.py", 15, 20), ("shop/db.py", 6, 9)]
    assert result.citations[0].why == "Users are loaded by get_user"
    assert result.citations[1].why == "It reads the row from SQLite"
    assert result.level == "high" and result.confidence == 0.9 and not result.not_found


def test_marker_after_the_full_stop_uses_that_sentence():
    result = check("The API wraps every route. [shop/api.py:1-5]")
    assert result.citations[0].why == "The API wraps every route"


def test_repeated_marker_gives_one_citation():
    result = check("A [shop/api.py:1-3]. B [shop/api.py:1-3].")
    assert len(result.citations) == 1 and result.markers_total == 2
    assert result.citations[0].why == "A"


def test_fake_marker_is_dropped_and_removed_from_the_answer():
    result = check("Real [shop/api.py:1-3]. Real too [shop/db.py:5-6]. Fake [shop/auth.py:1-9].")
    assert [d.marker for d in result.dropped] == ["[shop/auth.py:1-9]"]
    assert result.dropped[0].reason == "file is not in the index"
    assert result.answer == "Real [shop/api.py:1-3]. Real too [shop/db.py:5-6]. Fake."
    assert result.level == "medium" and result.confidence == 0.6


def test_lines_past_the_end_are_dropped():
    result = check("Real [shop/api.py:1-3]. Too long [shop/db.py:10-99].")
    assert "do not exist" in result.dropped[0].reason


def test_marker_outside_the_received_snippets_is_dropped():
    # shop/db.py:1-4 exists in the index but the Explainer only received lines 5-10
    result = check("Real [shop/api.py:1-3]. Not sent [shop/db.py:1-4].")
    assert result.dropped[0].reason == "range is not in the code the Explainer received"
    assert [c.file for c in result.citations] == ["shop/api.py"]


def test_more_than_half_dropped_is_low():
    result = check("A [shop/api.py:1-3]. B [x.py:1-2]. C [y.py:1-2].")
    assert result.level == "low" and result.confidence == 0.3 and not result.not_found


def test_all_markers_fake_means_not_found():
    result = check("Made up [auth.py:1-9] and [login.py:3-4].")
    assert result.not_found and result.citations == []
    assert result.answer == NOT_FOUND_ANSWER and len(result.dropped) == 2


def test_answer_without_markers_is_low():
    result = check("The shop module handles users.")
    assert result.level == "low" and not result.not_found and result.citations == []


def test_loose_marker_formats_are_normalized_and_checked():
    result = check("It parses headers (`shop/api.py:2-4`). It reads `[shop/db.py:6-9]`. "
                   "One line [shop/db.py:7]. Fake `shop/auth.py:1-2`.")
    assert [(c.file, c.start_line, c.end_line) for c in result.citations] == [
        ("shop/api.py", 2, 4), ("shop/db.py", 6, 9), ("shop/db.py", 7, 7)]
    assert result.answer == ("It parses headers ([shop/api.py:2-4]). It reads [shop/db.py:6-9]. "
                             "One line [shop/db.py:7-7]. Fake.")
    assert [d.marker for d in result.dropped] == ["[shop/auth.py:1-2]"]


def test_why_has_no_stray_backticks_or_markers():
    result = check("Saved by save_user [shop/db.py:5-6], and read by `get_user` `[shop/db.py:8-10]`.")
    assert result.citations[1].why == "Saved by save_user, and read by `get_user`"


def test_not_found_line():
    result = check("NOT_FOUND\nThe snippets do not mention payments.")
    assert result.not_found and result.answer == NOT_FOUND_ANSWER
    assert result.confidence == 0.0 and result.citations == []
