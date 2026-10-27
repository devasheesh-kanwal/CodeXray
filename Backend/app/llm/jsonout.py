"""Helpers for ask_json: ask for JSON, strip code fences, validate."""

import json
import re
from typing import Any

from pydantic import BaseModel

FENCE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)


def with_json_instruction(
    messages: list[dict[str, Any]], schema: type[BaseModel]
) -> list[dict[str, Any]]:
    """Add 'reply with JSON matching this schema' to the system message."""
    instruction = (
        "Reply with only one JSON object that matches this JSON schema. "
        "No prose and no code fences.\n"
        f"Schema: {json.dumps(schema.model_json_schema())}"
    )
    if messages and messages[0].get("role") == "system":
        first = {**messages[0], "content": f"{messages[0]['content']}\n\n{instruction}"}
        return [first, *messages[1:]]
    return [{"role": "system", "content": instruction}, *messages]


def strip_fences(text: str) -> str:
    """Return the inside of a ```json ... ``` block if there is one."""
    match = FENCE.search(text)
    return (match.group(1) if match else text).strip()


def parse_json(text: str, schema: type[BaseModel]) -> BaseModel:
    """Validate the model's text against the schema. Raises ValidationError."""
    return schema.model_validate_json(strip_fences(text))


def retry_messages(
    messages: list[dict[str, Any]], bad_output: str, error: str
) -> list[dict[str, Any]]:
    """Messages for the one retry: the bad answer plus what was wrong with it."""
    return [
        *messages,
        {"role": "assistant", "content": bad_output},
        {
            "role": "user",
            "content": (
                "Your reply was not valid for the schema. Errors:\n"
                f"{error}\n"
                "Reply again with only the corrected JSON object."
            ),
        },
    ]
