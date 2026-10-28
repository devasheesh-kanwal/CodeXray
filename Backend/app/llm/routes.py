"""Load the lane fallback chains from routes.yaml."""

from pathlib import Path

import yaml
from pydantic import BaseModel, Field

ROUTES_FILE = Path(__file__).parent / "routes.yaml"


class LaneEntry(BaseModel):
    """One model in a lane's fallback chain."""

    provider: str = Field(min_length=1)  # a built-in provider or one from EXTRA_PROVIDERS
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


def add_extra_models(lanes: dict[str, list[LaneEntry]], extras) -> dict[str, list[LaneEntry]]:
    """Append each extra provider's models to its lanes (all lanes by default), as last fallbacks."""
    lanes = {name: list(entries) for name, entries in lanes.items()}
    for extra in extras:
        for lane in extra.lanes or list(lanes):
            if lane not in lanes:
                raise ValueError(f"{extra.name.upper()}_LANES: unknown lane '{lane}'. Lanes: {sorted(lanes)}")
            for model, max_context in extra.models:
                lanes[lane].append(LaneEntry(provider=extra.name, model=model, max_context=max_context))
    return lanes
