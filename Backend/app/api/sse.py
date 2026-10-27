"""Server-Sent Events helpers.

Each event is written as:  event: <name>\\ndata: <json>\\n\\n
"""

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.errors import ApiError

logger = logging.getLogger("codexray")

SSE_RESPONSE_DOC: dict[int | str, dict[str, Any]] = {
    200: {
        "description": "Server-Sent Events stream (see docs/API.md for event formats).",
        "content": {"text/event-stream": {}},
    }
}


def sse_event(name: str, data: BaseModel | dict[str, Any]) -> str:
    """Format one SSE event with a JSON payload."""
    if isinstance(data, BaseModel):
        payload = data.model_dump_json()
    else:
        payload = json.dumps(data)
    return f"event: {name}\ndata: {payload}\n\n"


async def _with_error_event(events: AsyncIterator[str]) -> AsyncIterator[str]:
    """Turn an exception during streaming into a final 'error' event."""
    try:
        async for event in events:
            yield event
    except ApiError as exc:
        yield sse_event(
            "error", {"code": exc.code, "message": exc.message, "details": exc.details}
        )
    except Exception:
        logger.exception("Error while streaming")
        yield sse_event(
            "error",
            {"code": "INTERNAL_ERROR", "message": "Stream failed", "details": {}},
        )


def sse_response(events: AsyncIterator[str]) -> StreamingResponse:
    return StreamingResponse(
        _with_error_event(events),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
