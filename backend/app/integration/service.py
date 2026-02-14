from __future__ import annotations

import secrets
import time
from typing import Any
from urllib.parse import urlparse

from flask import current_app
from itsdangerous import BadSignature, BadTimeSignature, URLSafeTimedSerializer
from sqlalchemy import func

from ..common.errors import APIError
from ..extensions import db
from ..models import AppSettings, Role, User
from ..monitoring.quotas import get_or_create_quota


INVENTORY_PRO_SECRET_HEADER = "X-InventoryPro-Secret"
INVENTORY_PRO_SSO_MAX_AGE_SECONDS = 120
INVENTORY_PRO_SSO_TICKET_SALT = "inventory-pro-sso-ticket-v1"
_USED_SSO_TICKETS: dict[str, float] = {}


def normalize_inventory_pro_base_url(value: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        return ""
    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise APIError(400, "INVALID_INTEGRATION_URL", "InventoryPro URL must be a valid http(s) URL.")
    normalized = f"{parsed.scheme}://{parsed.netloc}{parsed.path or ''}".rstrip("/")
    return normalized


def inventory_pro_public_context(settings: AppSettings) -> dict[str, Any]:
    base_url = (settings.inventory_pro_base_url or "").strip()
    available = bool(settings.inventory_pro_enabled and settings.inventory_pro_dock_enabled and base_url)
    return {
        "enabled": bool(settings.inventory_pro_enabled),
        "dock_enabled": bool(settings.inventory_pro_dock_enabled),
        "base_url": base_url,
        "launch_url": base_url if available else "",
        "available": available,
    }


def require_inventory_pro_secret(settings: AppSettings, provided_secret: str | None) -> None:
    if not settings.inventory_pro_enabled:
        raise APIError(403, "INTEGRATION_DISABLED", "InventoryPro integration is disabled.")
    if not settings.has_inventory_pro_secret:
        raise APIError(400, "INTEGRATION_SECRET_MISSING", "InventoryPro shared secret is not configured.")
    if not settings.verify_inventory_pro_shared_secret((provided_secret or "").strip()):
        raise APIError(401, "INTEGRATION_AUTH_FAILED", "Invalid InventoryPro shared secret.")


def _normalize_role_names(raw_role_names: Any) -> list[str]:
    if not isinstance(raw_role_names, list):
        return []
    seen: set[str] = set()
    result: list[str] = []
    for raw in raw_role_names:
        if not isinstance(raw, str):
            continue
        role_name = raw.strip()
        if not role_name:
            continue
        key = role_name.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(role_name)
    return result


def _resolve_roles(settings: AppSettings, role_names: list[str]) -> list[Role]:
    selected: list[Role] = []
    if role_names:
        found = Role.query.filter(func.lower(Role.name).in_([name.lower() for name in role_names])).all()
        role_by_lower = {role.name.lower(): role for role in found}
        for name in role_names:
            matched = role_by_lower.get(name.lower())
            if matched is not None and matched not in selected:
                selected.append(matched)

    if selected:
        return selected

    default_name = (settings.inventory_pro_default_role_name or "user").strip() or "user"
    fallback_role = Role.query.filter(func.lower(Role.name) == default_name.lower()).one_or_none()
    if fallback_role is None:
        fallback_role = Role.query.filter(func.lower(Role.name) == "user").one_or_none()
    if fallback_role is None:
        raise APIError(500, "RBAC_NOT_READY", "Default role is missing.")
    return [fallback_role]


def _parse_positive_int(raw: Any, *, field: str) -> int | None:
    if raw is None or raw == "":
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError) as error:
        raise APIError(400, "INVALID_PARAMETER", f"{field} must be an integer.") from error
    if value <= 0:
        raise APIError(400, "INVALID_PARAMETER", f"{field} must be greater than 0.")
    return value


def upsert_inventory_pro_user(payload: dict[str, Any], settings: AppSettings, *, allow_create: bool) -> tuple[User, bool]:
    username = str(payload.get("username") or "").strip()
    subject = str(
        payload.get("subject")
        or payload.get("sub")
        or payload.get("inventory_pro_user_id")
        or payload.get("external_user_id")
        or ""
    ).strip()
    role_names = _normalize_role_names(payload.get("role_names"))
    is_active = bool(payload.get("is_active", True))
    bytes_limit = _parse_positive_int(payload.get("bytes_limit"), field="bytes_limit")

    if len(username) < 3:
        raise APIError(400, "INVALID_USERNAME", "username must be at least 3 characters.")
    if not subject:
        raise APIError(400, "INVALID_SUBJECT", "subject is required for InventoryPro identity mapping.")

    user = User.query.filter_by(inventory_pro_user_id=subject).one_or_none()
    if user is None:
        user = User.query.filter(func.lower(User.username) == username.lower()).one_or_none()

    created = False
    if user is None:
        if not allow_create:
            raise APIError(403, "AUTO_PROVISION_DISABLED", "Auto provisioning is disabled.")

        resolved_limit = bytes_limit if bytes_limit is not None else int(settings.default_quota)
        if resolved_limit <= 0:
            resolved_limit = 1

        user = User(
            username=username,
            is_active=is_active,
            bytes_limit=resolved_limit,
            bytes_used=0,
            inventory_pro_user_id=subject,
        )
        user.set_password(secrets.token_urlsafe(32))
        db.session.add(user)
        db.session.flush()
        created = True
    else:
        conflict = User.query.filter(func.lower(User.username) == username.lower(), User.id != user.id).one_or_none()
        if conflict is not None:
            raise APIError(409, "USER_EXISTS", "Username is already used by another account.")

        subject_conflict = User.query.filter(User.inventory_pro_user_id == subject, User.id != user.id).one_or_none()
        if subject_conflict is not None:
            raise APIError(409, "IDENTITY_CONFLICT", "InventoryPro subject is already linked to another account.")

        user.username = username
        user.inventory_pro_user_id = subject
        user.is_active = is_active
        if bytes_limit is not None:
            user.bytes_limit = max(bytes_limit, user.bytes_used)

    user.roles = _resolve_roles(settings, role_names)
    quota = get_or_create_quota(user)
    quota.bytes_limit = user.bytes_limit
    quota.bytes_used = user.bytes_used
    db.session.add(quota)

    return user, created


def _ticket_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["JWT_SECRET_KEY"], salt=INVENTORY_PRO_SSO_TICKET_SALT)


def _cleanup_used_tickets(now: float) -> None:
    expired = [jti for jti, ttl in _USED_SSO_TICKETS.items() if ttl <= now]
    for jti in expired:
        _USED_SSO_TICKETS.pop(jti, None)


def issue_inventory_pro_sso_ticket(user: User) -> str:
    now = time.time()
    _cleanup_used_tickets(now)

    payload = {"uid": user.id, "jti": secrets.token_urlsafe(18)}
    return _ticket_serializer().dumps(payload)


def consume_inventory_pro_sso_ticket(ticket: str) -> User:
    if not ticket:
        raise APIError(400, "MISSING_TICKET", "Missing SSO ticket.")

    try:
        data = _ticket_serializer().loads(ticket, max_age=INVENTORY_PRO_SSO_MAX_AGE_SECONDS)
    except BadTimeSignature as error:
        raise APIError(401, "SSO_TICKET_EXPIRED", "SSO ticket has expired.") from error
    except BadSignature as error:
        raise APIError(401, "SSO_TICKET_INVALID", "Invalid SSO ticket.") from error

    if not isinstance(data, dict):
        raise APIError(401, "SSO_TICKET_INVALID", "Invalid SSO ticket payload.")

    jti = str(data.get("jti") or "").strip()
    user_id_raw = data.get("uid")
    if not jti or user_id_raw is None:
        raise APIError(401, "SSO_TICKET_INVALID", "Invalid SSO ticket payload.")

    now = time.time()
    _cleanup_used_tickets(now)
    if jti in _USED_SSO_TICKETS:
        raise APIError(401, "SSO_TICKET_REPLAYED", "SSO ticket was already used.")
    _USED_SSO_TICKETS[jti] = now + INVENTORY_PRO_SSO_MAX_AGE_SECONDS

    try:
        user_id = int(user_id_raw)
    except (TypeError, ValueError) as error:
        raise APIError(401, "SSO_TICKET_INVALID", "Invalid user identity in SSO ticket.") from error

    user = db.session.get(User, user_id)
    if user is None or not user.is_active:
        raise APIError(401, "SSO_USER_INVALID", "User is not available for SSO.")
    return user
