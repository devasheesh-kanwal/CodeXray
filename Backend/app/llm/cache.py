"""SQLite cache of LLM responses (DATA_DIR/cache.sqlite)."""

import hashlib
import json
import sqlite3
import time
from contextlib import closing
from pathlib import Path
from typing import Any


def cache_key(
    lane: str,
    messages: list[dict[str, Any]],
    temperature: float,
    schema_name: str | None = None,
    tools: list[dict[str, Any]] | None = None,
    max_tokens: int | None = None,
) -> str:
    """Stable hash of everything that changes the answer."""
    payload = {
        "lane": lane,
        "messages": messages,
        "temperature": temperature,
        "schema": schema_name,
        "tools": tools,
    }
    if max_tokens is not None:  # only when set, so older cache keys stay valid
        payload["max_tokens"] = max_tokens
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class LLMCache:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(path)) as db, db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS responses ("
                "key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at REAL NOT NULL)"
            )

    def get(self, key: str) -> dict[str, Any] | None:
        with closing(sqlite3.connect(self.path)) as db:
            row = db.execute(
                "SELECT value FROM responses WHERE key = ?", (key,)
            ).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, key: str, value: dict[str, Any]) -> None:
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute(
                "INSERT OR REPLACE INTO responses (key, value, created_at) VALUES (?, ?, ?)",
                (key, json.dumps(value), time.time()),
            )
