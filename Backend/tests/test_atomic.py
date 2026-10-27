from pathlib import Path

import pytest

from app import atomic
from app.atomic import write_text_atomic


def test_writes_and_replaces(tmp_path):
    target = tmp_path / "meta.json"
    write_text_atomic(target, "one")
    write_text_atomic(target, "two")
    assert target.read_text(encoding="utf-8") == "two"
    assert not (tmp_path / "meta.json.tmp").exists()


def test_retries_while_windows_says_the_file_is_busy(tmp_path, monkeypatch):
    real_replace = Path.replace
    failures = iter([PermissionError("Access is denied")] * 3)

    def flaky_replace(self, target):
        error = next(failures, None)
        if error:
            raise error
        return real_replace(self, target)

    monkeypatch.setattr(Path, "replace", flaky_replace)
    monkeypatch.setattr(atomic, "RETRY_DELAY_S", 0)
    write_text_atomic(tmp_path / "meta.json", "ok")
    assert (tmp_path / "meta.json").read_text(encoding="utf-8") == "ok"


def test_gives_up_after_the_retries(tmp_path, monkeypatch):
    def always_busy(self, target):
        raise PermissionError("Access is denied")

    monkeypatch.setattr(Path, "replace", always_busy)
    monkeypatch.setattr(atomic, "RETRY_DELAY_S", 0)
    with pytest.raises(PermissionError):
        write_text_atomic(tmp_path / "meta.json", "x")
