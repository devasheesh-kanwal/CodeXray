"""Shared FastAPI dependencies."""

from fastapi import Request

from app.config import Settings


def get_settings(request: Request) -> Settings:
    """The Settings object the app was created with."""
    return request.app.state.settings
