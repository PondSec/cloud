from __future__ import annotations

from typing import Any

from flask import has_request_context, request
from sqlalchemy.exc import InvalidRequestError, OperationalError, ProgrammingError

from ..extensions import db
from ..models import AuditLog, User
from .schema_compat import ensure_audit_schema_compat


def _request_actor_ip() -> str | None:
    if not has_request_context():
        return None
    forwarded = request.headers.get("X-Forwarded-For") or ""
    if forwarded.strip():
        return forwarded.split(",")[0].strip()
    return request.remote_addr or None


def _request_user_agent() -> str | None:
    if not has_request_context():
        return None
    value = (request.headers.get("User-Agent") or "").strip()
    return value or None


def audit(
    action: str,
    actor: User | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    details: dict[str, Any] | None = None,
    *,
    entity_type: str | None = None,
    entity_id: str | None = None,
    metadata: dict[str, Any] | None = None,
    severity: str = "info",
    success: bool = True,
    actor_ip: str | None = None,
    user_agent: str | None = None,
) -> AuditLog | None:
    entry = AuditLog(
        actor_user_id=actor.id if actor else None,
        actor_ip=actor_ip or _request_actor_ip(),
        user_agent=user_agent or _request_user_agent(),
        action=action,
        entity_type=entity_type or target_type,
        entity_id=entity_id or target_id,
        metadata_json=metadata if metadata is not None else (details or {}),
        severity=(severity or "info").lower(),
        success=bool(success),
    )
    # Audit must never break the primary action (e.g. delete/upload).
    # On schema drift (old DB without new audit columns), skip audit entry.
    try:
        with db.session.begin_nested():
            db.session.add(entry)
            db.session.flush([entry])
    except (OperationalError, ProgrammingError):
        # Try to heal legacy schemas (created_at/details/target_*) once.
        try:
            ensure_audit_schema_compat()
        except Exception:
            pass

        # Remove failed entry from current session so outer commit
        # cannot re-attempt the broken INSERT.
        try:
            db.session.expunge(entry)
        except InvalidRequestError:
            pass
        return None

    return entry
