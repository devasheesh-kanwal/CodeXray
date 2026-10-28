"""Models for /api/embeddings and /api/embeddings/selection."""

from typing import Literal

from pydantic import BaseModel, Field

EmbeddingProviderId = Literal["gemini", "nvidia"]


class EmbeddingProvider(BaseModel):
    id: EmbeddingProviderId = Field(description="The value to send to PUT /api/embeddings/selection")
    label: str
    model: str
    available: bool = Field(description="false = no API key configured for it")


class EmbeddingsResponse(BaseModel):
    """Which provider makes the search vectors. Switching is by hand only; a repo
    without vectors from the selected model uses BM25 until they are added."""

    enabled: bool = Field(description="false = EMBEDDINGS=false: BM25 search only")
    selected: EmbeddingProviderId
    providers: list[EmbeddingProvider]
    adding_vectors: list[str] = Field(
        description="repo_ids being embedded with the selected model right now (BM25 until done)")


class EmbeddingSelectionRequest(BaseModel):
    provider: EmbeddingProviderId
