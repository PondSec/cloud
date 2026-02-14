from __future__ import annotations

from typing import Any

from flask import has_request_context, request
from sqlalchemy.exc import InvalidRequestError, OperationalError, ProgrammingError

from ..extensions import db
from ..models import AuditEvent, User, utc_now
from .audit_hash import GENESIS_HASH, compute_event_hash
from .feature_flags import flag_enabled


def _request_actor_ip() -> str | None:
    if not has_request_context():
        return None
    forwarded = request.headers.get("X-Forwarded-For") or ""
    if forwarded.strip():
        return forwarded.split(",", 1)[0].strip()
    return request.remote_addr or None


def _request_user_agent() -> str | None:
    if not has_request_context():
        return None
    value = (request.headers.get("User-Agent") or "").strip()
    return value or None


def _last_event_hash() -> str:
    last = db.session.query(AuditEvent.event_hash).order_by(AuditEvent.id.desc()).limit(1).one_or_none()
    if not last or not last[0]:
        return GENESIS_HASH
    return str(last[0])


def _event_hash_payload(event: AuditEvent) -> dict[str, Any]:
    return {
        "ts": event.ts,
        "actor_user_id": event.actor_user_id,
        "actor_ip": event.actor_ip,
        "user_agent": event.user_agent,
        "action": event.action,
        "entity_type": event.entity_type,
        "entity_id": event.entity_id,
        "metadata": event.metadata_json or {},
        "severity": event.severity,
        "success": bool(event.success),
    }


class AuditBus:
    def emit(self, payload: dict[str, Any]) -> AuditEvent | None:
        """
        Emit a tamper-evident audit event.

        Expected payload keys:
        - actor: User | None
        - action: str
        - resource: {type: str, id: str} (optional)
        - metadata: dict (optional)
        - ip: str (optional)
        - ua: str (optional)
        - result: {success: bool, severity: str} (optional)
        """

        if not flag_enabled("audit.hash_chain", default=False):
            return None

        actor = payload.get("actor")
        actor_user_id: int | None = actor.id if isinstance(actor, User) else None

        action = str(payload.get("action") or "").strip()
        if not action:
            return None

        resource = payload.get("resource") if isinstance(payload.get("resource"), dict) else {}
        entity_type = str(resource.get("type") or "").strip() or None
        entity_id = str(resource.get("id") or "").strip() or None

        metadata_raw = payload.get("metadata")
        metadata: dict[str, Any] = metadata_raw if isinstance(metadata_raw, dict) else {}

        result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
        severity = str(result.get("severity") or "info").strip().lower() or "info"
        success = bool(result.get("success", True))

        event = AuditEvent(
            ts=utc_now(),
            actor_user_id=actor_user_id,
            actor_ip=str(payload.get("ip") or _request_actor_ip() or "") or None,
            user_agent=str(payload.get("ua") or _request_user_agent() or "") or None,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            metadata_json=metadata,
            severity=severity,
            success=success,
            prev_hash=GENESIS_HASH,
            event_hash=GENESIS_HASH,
        )

        try:
            with db.session.begin_nested():
                prev_hash = _last_event_hash()
                event.prev_hash = prev_hash
                event.event_hash = compute_event_hash(prev_hash, _event_hash_payload(event))
                db.session.add(event)
                db.session.flush([event])
        except (OperationalError, ProgrammingError):
            # Audit must never break the primary action (e.g. delete/upload).
            try:
                db.session.expunge(event)
            except InvalidRequestError:
                pass
            return None

        return event


audit = AuditBus()

