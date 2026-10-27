"""Application settings, loaded from .env files and environment variables."""

from pathlib import Path
from typing import Annotated

from pydantic import Field, SecretStr, ValidationError, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent

# Later files win: Backend/.env overrides the repo-root .env.
ENV_FILES = (REPO_ROOT / ".env", BACKEND_DIR / ".env")

KeyList = Annotated[list[SecretStr], NoDecode]


class Settings(BaseSettings):
    """All backend settings. Field names map to upper-case env variables."""

    model_config = SettingsConfigDict(
        env_file=ENV_FILES, env_file_encoding="utf-8", extra="ignore"
    )

    mock_mode: bool = True
    demo_mode: bool = False
    frontend_origin: str
    data_dir: Path = Path("data")
    llm_timeout_s: float = Field(default=30, gt=0)

    # Indexing
    gemini_embedding_model: str = "gemini-embedding-2"
    embeddings: bool = True  # false = BM25 search only, no embedding calls
    file_summaries: bool = False  # true = one-line LLM summary per file

    # Q&A: below the threshold the answer is "No relevant code found"
    not_found_threshold: float = Field(default=0.68, ge=0, le=1)  # hybrid search
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
        return Settings()
    except ValidationError as exc:
        lines = ["CodeXray cannot start: invalid or missing settings."]
        for error in exc.errors():
            name = str(error["loc"][0]).upper() if error["loc"] else "?"
            message = "is required" if error["type"] == "missing" else error["msg"]
            lines.append(f"  - {name}: {message}")
        lines.append("Set them in Backend/.env (see Backend/.env.example).")
        raise SystemExit("\n".join(lines)) from None
