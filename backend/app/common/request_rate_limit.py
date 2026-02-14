from __future__ import annotations

from flask import current_app, request
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request

from .errors import APIError
from .feature_flags import flag_enabled
from .rate_limit import SlidingWindowRateLimiter, parse_rate_limit


def _request_ip() -> str:
    forwarded = request.headers.get("X-Forwarded-For") or ""
    if forwarded.strip():
        return forwarded.split(",", 1)[0].strip()
    return request.remote_addr or "unknown"


def _request_user_id() -> str:
    try:
        verify_jwt_in_request(optional=True)
        ident = get_jwt_identity()
        if ident is None:
            return "anon"
        return str(ident)
    except Exception:
        return "anon"


def _endpoint_class() -> str:
    blueprint = (request.blueprint or "").strip()
    method = (request.method or "").upper()

    if blueprint == "files":
        return "files_read" if method in {"GET", "HEAD"} else "files_write"
    if blueprint == "office" or blueprint == "api_office" or blueprint == "api_office_legacy":
        return "office"
    if blueprint in {"shares", "public_shares"}:
        return "shares"
    if blueprint == "auth":
        return "auth"
    if blueprint == "admin":
        return "admin"
    if blueprint == "mail":
        return "mail"
    if blueprint == "integration":
        return "integration"
    return "default"


def _rate_limit_spec_for_class(class_name: str) -> str:
    mapping = {
        "auth": "RATE_LIMIT_AUTH",
        "files_read": "RATE_LIMIT_FILES_READ",
        "files_write": "RATE_LIMIT_FILES_WRITE",
        "shares": "RATE_LIMIT_SHARES",
        "office": "RATE_LIMIT_OFFICE",
        "admin": "RATE_LIMIT_ADMIN",
        "mail": "RATE_LIMIT_MAIL",
        "integration": "RATE_LIMIT_INTEGRATION",
        "default": "RATE_LIMIT_DEFAULT",
    }
    key = mapping.get(class_name, "RATE_LIMIT_DEFAULT")
    return str(current_app.config.get(key) or current_app.config.get("RATE_LIMIT_DEFAULT") or "")


def _get_limiter() -> SlidingWindowRateLimiter:
    limiter = current_app.extensions.get("request_rate_limiter")
    if isinstance(limiter, SlidingWindowRateLimiter):
        return limiter
    limiter = SlidingWindowRateLimiter()
    current_app.extensions["request_rate_limiter"] = limiter
    return limiter


def rate_limit_request() -> None:
    if request.method == "OPTIONS":
        return

    if not flag_enabled("security.rate_limit", default=False):
        return

    # Monitoring + audit already implement their own rate limiting logic (and different ACLs).
    if request.blueprint in {"monitoring", "audit"}:
        return

    class_name = _endpoint_class()
    spec = _rate_limit_spec_for_class(class_name)
    max_attempts, window_seconds = parse_rate_limit(spec, default_attempts=600, default_window=60)

    limiter = _get_limiter()
    key = f"{class_name}:{_request_ip()}:{_request_user_id()}:{request.endpoint or 'unknown'}"
    if not limiter.allow(key, max_attempts=max_attempts, window_seconds=window_seconds):
        raise APIError(429, "RATE_LIMITED", "API rate limit exceeded.")

