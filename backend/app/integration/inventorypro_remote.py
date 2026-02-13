from __future__ import annotations

import json
import socket
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from flask import current_app

from ..common.errors import APIError
from ..models import AppSettings, User


INVENTORY_PRO_SECRET_HEADER = "X-InventoryPro-Secret"


def _require_outbound_inventorypro_config(settings: AppSettings) -> tuple[str, str]:
    if not settings.inventory_pro_enabled:
        raise APIError(403, "INTEGRATION_DISABLED", "InventoryPro integration is disabled.")

    base_url = (settings.inventory_pro_base_url or "").strip()
    if not base_url:
        raise APIError(400, "INVENTORYPRO_URL_MISSING", "InventoryPro base URL is not configured.")

    # Cloud must keep a usable copy for outbound calls. If only the hash exists (older DB),
    # the admin has to re-enter the shared secret once.
    secret = (settings.inventory_pro_shared_secret_plain or "").strip()
    if not secret:
        if settings.has_inventory_pro_secret:
            raise APIError(
                400,
                "INVENTORYPRO_SECRET_REENTER_REQUIRED",
                "InventoryPro shared secret must be re-entered (settings) to enable outbound calls.",
            )
        raise APIError(400, "INVENTORYPRO_SECRET_MISSING", "InventoryPro shared secret is not configured.")

    return base_url.rstrip("/"), secret


def _join_base_url(base_url: str, path: str) -> str:
    base = (base_url or "").rstrip("/")
    clean_path = (path or "").strip()
    if not clean_path.startswith("/"):
        clean_path = f"/{clean_path}"
    return f"{base}{clean_path}"


def inventorypro_request_json(
    settings: AppSettings,
    *,
    method: str,
    path: str,
    query: dict[str, Any] | None = None,
    body: dict[str, Any] | None = None,
    timeout_seconds: int = 20,
) -> dict[str, Any]:
    base_url, secret = _require_outbound_inventorypro_config(settings)

    url = _join_base_url(base_url, path)
    if query:
        url = f"{url}?{urllib.parse.urlencode(query, doseq=True)}"

    payload: bytes | None = None
    if body is not None:
        payload = json.dumps(body).encode("utf-8")

    request_obj = urllib.request.Request(url, data=payload, method=method.upper())
    request_obj.add_header("Accept", "application/json")
    request_obj.add_header(INVENTORY_PRO_SECRET_HEADER, secret)
    request_obj.add_header("User-Agent", "PondSec-Cloud/InventoryPro")
    if payload is not None:
        request_obj.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(request_obj, timeout=timeout_seconds) as response:
            raw = response.read()
            try:
                parsed = json.loads(raw.decode("utf-8", errors="replace") or "{}")
            except json.JSONDecodeError as error:
                raise APIError(502, "INVENTORYPRO_INVALID_RESPONSE", "InventoryPro returned invalid JSON.") from error

            if not isinstance(parsed, dict):
                raise APIError(502, "INVENTORYPRO_INVALID_RESPONSE", "InventoryPro returned invalid JSON payload.")
            return parsed
    except urllib.error.HTTPError as error:
        raw = error.read() or b""
        content_type = (error.headers.get("Content-Type") or "").lower()
        details: dict[str, Any] = {"status": error.code}
        upstream_message = ""
        if "application/json" in content_type and raw:
            try:
                parsed = json.loads(raw.decode("utf-8", errors="replace") or "{}")
                if isinstance(parsed, dict):
                    details["upstream"] = parsed
                    upstream_message = str(parsed.get("error") or parsed.get("message") or "").strip()
            except json.JSONDecodeError:
                pass
        if not upstream_message and raw:
            upstream_message = raw.decode("utf-8", errors="replace").strip()

        message = "InventoryPro request failed."
        if upstream_message:
            message = f"InventoryPro request failed: {upstream_message}"
        raise APIError(max(400, min(int(error.code or 502), 599)), "INVENTORYPRO_UPSTREAM_ERROR", message, details)
    except (urllib.error.URLError, TimeoutError, socket.timeout, OSError) as error:
        current_app.logger.warning("InventoryPro request failed", exc_info=True)
        raise APIError(
            502,
            "INVENTORYPRO_UNREACHABLE",
            "InventoryPro ist vom Cloud-Server aus nicht erreichbar.",
            {"reason": str(error)},
        ) from error


def build_inventorypro_sso_payload(user: User) -> dict[str, Any]:
    return {
        "subject": str(user.id),
        "username": user.username,
        "role_names": [role.name for role in (user.roles or [])],
        "is_active": bool(user.is_active),
    }

