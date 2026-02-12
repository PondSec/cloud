from __future__ import annotations

from typing import Any

from ..extensions import db
from ..models import AuditLog, User


def audit(
    action: str,
    actor: User | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    entry = AuditLog(
        actor_user_id=actor.id if actor else None,
        action=action,
        target_type=target_type,
        target_id=target_id,
        details=details or {},
    )
    db.session.add(entry)
