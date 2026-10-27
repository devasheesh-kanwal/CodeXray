"""Load the lane fallback chains from routes.yaml."""

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field

ROUTES_FILE = Path(__file__).parent / "routes.yaml"

ProviderName = Literal["nvidia", "groq", "gemini", "openrouter", "deepseek"]


class LaneEntry(BaseModel):
    """One model in a lane's fallback chain."""

    provider: ProviderName
    model: str = Field(min_length=1)
    max_context: int = Field(gt=0)

    @property
    def label(self) -> str:
        return f"{self.provider}/{self.model}"


class RoutesFile(BaseModel):
    lanes: dict[str, list[LaneEntry]] = Field(min_length=1)


def load_routes(path: Path = ROUTES_FILE) -> dict[str, list[LaneEntry]]:
    """Read and validate routes.yaml. Raises if the file is malformed."""
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    lanes = RoutesFile.model_validate(data).lanes
    empty = [name for name, entries in lanes.items() if not entries]
    if empty:
        raise ValueError(f"routes.yaml: lanes with no entries: {empty}")
    return lanes
