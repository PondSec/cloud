from __future__ import annotations

from typing import Any

from flask import Blueprint, jsonify, request

from ..common.audit import audit
from ..common.errors import APIError
from ..extensions import db
from ..models import AppSettings
from .service import (
    INVENTORY_PRO_SECRET_HEADER,
    INVENTORY_PRO_SSO_MAX_AGE_SECONDS,
    issue_inventory_pro_sso_ticket,
    require_inventory_pro_secret,
    upsert_inventory_pro_user,
)


integration_bp = Blueprint("integration", __name__, url_prefix="/integration/inventorypro")


def _ensure_payload_dict(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise APIError(400, "INVALID_PAYLOAD", "JSON object expected.")
    return payload


@integration_bp.post("/users/sync")
def sync_users():
    settings = AppSettings.singleton()
    if not settings.inventory_pro_sync_enabled:
        raise APIError(403, "SYNC_DISABLED", "InventoryPro user sync is disabled.")

    require_inventory_pro_secret(settings, request.headers.get(INVENTORY_PRO_SECRET_HEADER))

    payload = _ensure_payload_dict(request.get_json(silent=True) or {})
    if isinstance(payload.get("users"), list):
        entries = payload.get("users") or []
    else:
        entries = [payload]

    if not entries:
        raise APIError(400, "INVALID_PAYLOAD", "At least one user payload is required.")

    synced_items: list[dict[str, Any]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise APIError(400, "INVALID_PAYLOAD", "Each users item must be an object.")
        user, created = upsert_inventory_pro_user(
            entry,
            settings,
            allow_create=bool(settings.inventory_pro_auto_provision_users),
        )
        synced_items.append(
            {
                "status": "created" if created else "updated",
                "id": user.id,
                "username": user.username,
                "inventory_pro_user_id": user.inventory_pro_user_id,
                "is_active": user.is_active,
            }
        )

    audit(
        action="integration.inventorypro.user_sync",
        actor=None,
        target_type="integration",
        target_id="inventorypro",
        details={"count": len(synced_items)},
    )
    db.session.commit()

    return jsonify({"items": synced_items, "count": len(synced_items)})


@integration_bp.post("/sso/ticket")
def create_sso_ticket():
    settings = AppSettings.singleton()
    if not settings.inventory_pro_sso_enabled:
        raise APIError(403, "SSO_DISABLED", "InventoryPro SSO is disabled.")

    require_inventory_pro_secret(settings, request.headers.get(INVENTORY_PRO_SECRET_HEADER))

    payload = _ensure_payload_dict(request.get_json(silent=True) or {})
    user, created = upsert_inventory_pro_user(
        payload,
        settings,
        allow_create=bool(settings.inventory_pro_auto_provision_users),
    )
    if not user.is_active:
        raise APIError(403, "USER_INACTIVE", "User is inactive.")

    ticket = issue_inventory_pro_sso_ticket(user)
    audit(
        action="integration.inventorypro.sso_ticket",
        actor=None,
        target_type="user",
        target_id=str(user.id),
        details={"created": created, "username": user.username},
    )
    db.session.commit()

    return jsonify(
        {
            "ticket": ticket,
            "expires_in": INVENTORY_PRO_SSO_MAX_AGE_SECONDS,
            "user": {"id": user.id, "username": user.username},
        }
    )
