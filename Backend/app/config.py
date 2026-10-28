"""Application settings, loaded from .env files and environment variables."""

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal

from dotenv import dotenv_values

from pydantic import Field, SecretStr, ValidationError, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent

# Later files win: Backend/.env overrides the repo-root .env.
ENV_FILES = (REPO_ROOT / ".env", BACKEND_DIR / ".env")

KeyList = Annotated[list[SecretStr], NoDecode]
NameList = Annotated[list[str], NoDecode]

BUILTIN_PROVIDERS = ("nvidia", "groq", "gemini", "openrouter", "deepseek")
EXTRA_DEFAULT_CONTEXT = 32768  # max_context for an extra model listed without "@<tokens>"


@dataclass(frozen=True)
class ExtraProvider:
    """An OpenAI-compatible provider added in .env (EXTRA_PROVIDERS), not in the code."""

    name: str
    base_url: str
    keys: list[SecretStr]
    models: list[tuple[str, int]]  # (model id, max_context)
    lanes: list[str] | None  # None = add its models to every lane


def _split(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


class Settings(BaseSettings):
    """All backend settings. Field names map to upper-case env variables."""

    model_config = SettingsConfigDict(
        env_file=ENV_FILES, env_file_encoding="utf-8", extra="ignore"
    )

    mock_mode: bool = True
    demo_mode: bool = False
    demo_repo_path: Path | None = None  # repo scripts/demo_prepare.py indexes and caches
    frontend_origin: str
    data_dir: Path = Path("data")
    llm_timeout_s: float = Field(default=30, gt=0)

    # Indexing: embeddings from Gemini or NVIDIA, switchable in the app (never automatic)
    embedding_provider: Literal["gemini", "nvidia"] = "gemini"
    gemini_embedding_model: str = "gemini-embedding-2"
    nvidia_embedding_model: str = "nvidia/nemotron-3.5-embed-1b"
    embeddings: bool = True  # false = BM25 search only, no embedding calls
    file_summaries: bool = False  # true = one-line LLM summary per file

    # Q&A: below the threshold the answer is "No relevant code found"
    not_found_threshold: float = Field(default=0.68, ge=0, le=1)  # hybrid search, Gemini vectors
    not_found_threshold_nvidia: float = Field(default=0.3, ge=0, le=1)  # hybrid search, NVIDIA vectors
    not_found_threshold_bm25: float = Field(default=0.5, ge=0, le=1)  # bm25_only search
    qa_context_tokens: int = Field(default=12000, gt=0)  # snippets sent to the Explainer

    # Repair: test runs in the sandbox (Docker image if Docker is available)
    repair_test_timeout_s: float = Field(default=120, gt=0)
    sandbox_image: str = "codexray-sandbox:latest"

    # Provider key lists: comma-separated in .env, e.g. GROQ_API_KEYS=key1,key2
    nvidia_api_keys: KeyList = Field(default_factory=list)
    groq_api_keys: KeyList = Field(default_factory=list)
    gemini_api_keys: KeyList = Field(default_factory=list)
    openrouter_api_keys: KeyList = Field(default_factory=list)
    deepseek_api_keys: KeyList = Field(default_factory=list)

    # More OpenAI-compatible providers, e.g. EXTRA_PROVIDERS=together,mistral.
    # Each needs <NAME>_BASE_URL, <NAME>_API_KEYS and <NAME>_MODELS (see .env.example).
    extra_providers: NameList = Field(default_factory=list)

    @field_validator("extra_providers", mode="before")
    @classmethod
    def split_names(cls, value: object) -> object:
        if isinstance(value, str):
            return [name.lower() for name in _split(value)]
        return value

    @field_validator(
        "nvidia_api_keys",
        "groq_api_keys",
        "gemini_api_keys",
        "openrouter_api_keys",
        "deepseek_api_keys",
        mode="before",
    )
    @classmethod
    def split_keys(cls, value: object) -> object:
        if isinstance(value, str):
            return [key.strip() for key in value.split(",") if key.strip()]
        return value

    @field_validator("frontend_origin")
    @classmethod
    def check_origin(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if value == "*":
            raise ValueError("must be one exact origin, not '*'")
        if not value.startswith(("http://", "https://")):
            raise ValueError("must start with http:// or https://")
        return value

    def extra_provider_configs(self, env: Mapping[str, str] | None = None) -> list[ExtraProvider]:
        """The EXTRA_PROVIDERS, read from <NAME>_BASE_URL/_API_KEYS/_MODELS/_LANES.

        `env` defaults to the .env files plus the process environment (which wins).
        Raises ValueError with a readable message if one is incomplete.
        """
        if env is None:
            env = {}
            for file in ENV_FILES:
                if file.exists():
                    env.update({k.upper(): v for k, v in dotenv_values(file).items() if v is not None})
            env.update({k.upper(): v for k, v in os.environ.items()})
        providers = []
        for name in self.extra_providers:
            if not re.fullmatch(r"[a-z][a-z0-9_]*", name):
                raise ValueError(f"EXTRA_PROVIDERS: '{name}' must be letters, digits or _ (starting with a letter)")
            if name in BUILTIN_PROVIDERS:
                raise ValueError(f"EXTRA_PROVIDERS: '{name}' is built in; set {name.upper()}_API_KEYS instead")
            prefix = name.upper()
            base_url = env.get(f"{prefix}_BASE_URL", "").strip().rstrip("/")
            if not base_url.startswith(("http://", "https://")):
                raise ValueError(f"{prefix}_BASE_URL must be the provider's OpenAI-compatible URL (https://...)")
            models = []
            for item in _split(env.get(f"{prefix}_MODELS", "")):
                model, _, context = item.rpartition("@") if "@" in item else (item, "", "")
                if context and not context.isdigit():
                    raise ValueError(f"{prefix}_MODELS: '{item}' must be <model> or <model>@<max context tokens>")
                models.append((model.strip(), int(context) if context else EXTRA_DEFAULT_CONTEXT))
            if not models:
                raise ValueError(f"{prefix}_MODELS must list at least one model, e.g. llama-3.3-70b@131072")
            lanes = _split(env.get(f"{prefix}_LANES", "")) or None
            keys = [SecretStr(k) for k in _split(env.get(f"{prefix}_API_KEYS", ""))]
            providers.append(ExtraProvider(name, base_url, keys, models, lanes))
        return providers

    @property
    def data_path(self) -> Path:
        """DATA_DIR as an absolute path (relative values are under Backend/)."""
        if self.data_dir.is_absolute():
            return self.data_dir
        return BACKEND_DIR / self.data_dir


def mask_key(key: SecretStr | str) -> str:
    """Show only the last 4 characters of a key, for logs and errors."""
    raw = key.get_secret_value() if isinstance(key, SecretStr) else key
    return "****" + raw[-4:] if len(raw) > 4 else "****"


def load_settings() -> Settings:
    """Load settings, or exit with a readable message if something is wrong."""
    try:
        settings = Settings()
        settings.extra_provider_configs()  # fail at startup, not on the first LLM call
        return settings
    except ValidationError as exc:
        lines = ["CodeXray cannot start: invalid or missing settings."]
        for error in exc.errors():
            name = str(error["loc"][0]).upper() if error["loc"] else "?"
            message = "is required" if error["type"] == "missing" else error["msg"]
            lines.append(f"  - {name}: {message}")
        lines.append("Set them in Backend/.env (see Backend/.env.example).")
        raise SystemExit("\n".join(lines)) from None
    except ValueError as exc:  # an incomplete EXTRA_PROVIDERS entry
        raise SystemExit(f"CodeXray cannot start: {exc}\nSee EXTRA_PROVIDERS in Backend/.env.example.") from None
