import pytest
from pydantic import SecretStr, ValidationError

from app.config import Settings, load_settings, mask_key
from tests.conftest import make_settings


def test_wildcard_origin_is_rejected(tmp_path):
    with pytest.raises(ValidationError, match="not '\\*'"):
        make_settings(tmp_path, frontend_origin="*")


def test_origin_without_scheme_is_rejected(tmp_path):
    with pytest.raises(ValidationError, match="http"):
        make_settings(tmp_path, frontend_origin="localhost:5173")


def test_missing_frontend_origin_fails_fast_with_clear_message(monkeypatch):
    monkeypatch.delenv("FRONTEND_ORIGIN", raising=False)
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    with pytest.raises(SystemExit) as exc:
        load_settings()
    message = str(exc.value)
    assert "FRONTEND_ORIGIN: is required" in message
    assert ".env.example" in message


def test_key_lists_are_comma_separated_and_secret(monkeypatch, tmp_path):
    monkeypatch.setenv("GROQ_API_KEYS", "gsk_first1234, gsk_second5678")
    settings = make_settings(tmp_path)
    assert [k.get_secret_value() for k in settings.groq_api_keys] == [
        "gsk_first1234",
        "gsk_second5678",
    ]
    assert "gsk_first1234" not in repr(settings)
    assert settings.nvidia_api_keys == []


def test_mask_key_shows_only_last_four():
    assert mask_key(SecretStr("gsk_abcdefgh1234")) == "****1234"
    assert mask_key("abc") == "****"
