"""One error format for every endpoint: {"error": {"code", "message", "details"}}."""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("codexray")

STATUS_CODES = {
    400: "BAD_REQUEST",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "INVALID_STATE",
    422: "VALIDATION_ERROR",
    501: "NOT_IMPLEMENTED",
}


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ErrorResponse(BaseModel):
    error: ErrorBody


class ApiError(Exception):
    """Raise this from routes and workflows to return a structured error."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or {}


def not_found(what: str, **details: Any) -> ApiError:
    return ApiError(404, "NOT_FOUND", f"{what} not found", details)


def not_implemented(feature: str, prompt: str) -> ApiError:
    return ApiError(
        501,
        "NOT_IMPLEMENTED",
        f"{feature} is not implemented yet (prompt {prompt}). Set MOCK_MODE=true.",
        {"feature": feature, "prompt": prompt},
    )


def error_json(
    status_code: int, code: str, message: str, details: dict[str, Any] | None = None
) -> JSONResponse:
    body = ErrorResponse(
        error=ErrorBody(code=code, message=message, details=details or {})
    )
    return JSONResponse(status_code=status_code, content=body.model_dump())


async def handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
    return error_json(exc.status_code, exc.code, exc.message, exc.details)


async def handle_http_error(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    code = STATUS_CODES.get(exc.status_code, "HTTP_ERROR")
    return error_json(exc.status_code, code, str(exc.detail))


async def handle_validation_error(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    problems = [
        {
            "field": ".".join(str(part) for part in err["loc"]),
            "message": err["msg"],
        }
        for err in exc.errors()
    ]
    return error_json(422, "VALIDATION_ERROR", "Request is invalid", {"errors": problems})


async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return error_json(500, "INTERNAL_ERROR", "Something went wrong on the server")


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, handle_api_error)
    app.add_exception_handler(StarletteHTTPException, handle_http_error)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
    app.add_exception_handler(Exception, handle_unexpected_error)
