from __future__ import annotations

from urllib.parse import urlparse

from flask import current_app, request

from .errors import APIError
from .feature_flags import flag_enabled


_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _origin_from_referer(referer: str) -> str:
    raw = (referer or "").strip()
    if not raw:
        return ""
    try:
        parsed = urlparse(raw)
    except ValueError:
        return ""
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc}"


def _is_allowed_origin(origin: str) -> bool:
    origin = (origin or "").strip()
    if not origin:
        return True

    allowed = current_app.config.get("FRONTEND_ORIGINS") or []
    if not isinstance(allowed, list):
        return False

    normalized = [str(item).strip() for item in allowed if str(item).strip()]
    if "*" in normalized:
        # Unsafe, but if configured we treat it as explicit operator intent.
        return True
    return origin in normalized


def csrf_origin_protect() -> None:
    """
    CSRF baseline: origin/referrer validation for state-changing requests.

    When enabled, any request with an Origin/Referer outside FRONTEND_ORIGINS is rejected.
    Requests without Origin/Referer (common for non-browser clients) are allowed.
    """

    if request.method in _SAFE_METHODS:
        return

    if not flag_enabled("security.csrf", default=False):
        return

    origin = (request.headers.get("Origin") or "").strip()
    if not origin:
        origin = _origin_from_referer(request.headers.get("Referer") or "")

    if not origin:
        return

    if not _is_allowed_origin(origin):
        raise APIError(403, "CSRF_BLOCKED", "Cross-site request blocked.")

