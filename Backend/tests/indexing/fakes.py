"""A fake Gemini embedding API (httpx2 transport) for tests. No network."""

import hashlib
import json
import math
from dataclasses import dataclass, field

import httpx2

from app.indexing.embedder import DIMENSIONS
from app.indexing.tokenize import tokenize


def fake_vector(text: str) -> list[float]:
    """Bag-of-words vector: texts sharing words get similar vectors."""
    vector = [0.0] * DIMENSIONS
    for token in tokenize(text):
        vector[int(hashlib.md5(token.encode()).hexdigest(), 16) % DIMENSIONS] += 1.0
    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [v / norm for v in vector]


@dataclass
class FakeGemini:
    """Answers batchEmbedContents. `failures` = statuses to return before succeeding."""

    failures: list[int] = field(default_factory=list)
    bad_keys: set[str] = field(default_factory=set)
    retry_after: str | None = None  # Retry-After header
    retry_delay: str | None = None  # Gemini RetryInfo.retryDelay in the body, e.g. "37s"
    fail_after_requests: int | None = None  # every request after this many gets a 500
    requests: list[httpx2.Request] = field(default_factory=list)

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        if request.headers.get("x-goog-api-key") in self.bad_keys:
            return httpx2.Response(401, json={"error": {"message": "API key not valid"}})
        if self.fail_after_requests is not None and len(self.requests) > self.fail_after_requests:
            return httpx2.Response(500, json={"error": {"message": "internal"}})
        if self.failures:
            status = self.failures.pop(0)
            headers = {"retry-after": self.retry_after} if self.retry_after else {}
            error = {"message": "busy"}
            if self.retry_delay:  # how Gemini really says it: in the body
                error["details"] = [{"@type": "type.googleapis.com/google.rpc.RetryInfo",
                                     "retryDelay": self.retry_delay}]
            return httpx2.Response(status, json={"error": error}, headers=headers)
        body = json.loads(request.content)
        return httpx2.Response(
            200,
            json={"embeddings": [
                {"values": fake_vector(r["content"]["parts"][0]["text"])} for r in body["requests"]
            ]},
        )

    def transport(self) -> httpx2.MockTransport:
        return httpx2.MockTransport(self.handle)

    def texts_sent(self) -> list[str]:
        return [
            r["content"]["parts"][0]["text"]
            for req in self.requests if req.content
            for r in json.loads(req.content)["requests"]
        ]
