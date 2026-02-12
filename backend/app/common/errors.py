from __future__ import annotations

from typing import Any

from flask import Flask, jsonify
from werkzeug.exceptions import HTTPException


class APIError(Exception):
    def __init__(self, status_code: int, code: str, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or {}


def error_payload(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
        }
    }


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(APIError)
    def handle_api_error(error: APIError):  # type: ignore[no-untyped-def]
        return jsonify(error_payload(error.code, error.message, error.details)), error.status_code

    @app.errorhandler(HTTPException)
    def handle_http_error(error: HTTPException):  # type: ignore[no-untyped-def]
        return (
            jsonify(error_payload("HTTP_ERROR", error.description, {"status": error.code})),
            error.code or 500,
        )

    @app.errorhandler(Exception)
    def handle_unexpected_error(error: Exception):  # type: ignore[no-untyped-def]
        app.logger.exception("Unhandled exception", exc_info=error)
        return jsonify(error_payload("INTERNAL_ERROR", "An unexpected error occurred.")), 500
