from __future__ import annotations

from app.common.audit_hash import GENESIS_HASH, compute_event_hash
from app.extensions import db
from app.models import AuditEvent, Role, User


def _event_payload(event: AuditEvent) -> dict:
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


def _access_token(client, username: str, password: str) -> str:
    response = client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return response.get_json()["access_token"]


def test_audit_events_are_hash_chained_when_enabled(app, client):
    flags = dict(app.config.get("FEATURE_FLAGS") or {})
    flags["audit.hash_chain"] = True
    app.config["FEATURE_FLAGS"] = flags

    token = _access_token(client, "alice", "alicepass")
    headers = {"Authorization": f"Bearer {token}"}

    create = client.post("/files/folder", json={"name": "audit-chain-folder", "parent_id": None}, headers=headers)
    assert create.status_code == 201

    logout = client.post("/auth/logout", json={}, headers=headers)
    assert logout.status_code == 200

    with app.app_context():
        events = AuditEvent.query.order_by(AuditEvent.id.asc()).all()

        # We expect at least: files.folder_create + auth.logout (+ auth.login from token acquisition).
        assert len(events) >= 2

        prev_hash = GENESIS_HASH
        for event in events:
            assert event.prev_hash == prev_hash
            expected = compute_event_hash(prev_hash, _event_payload(event))
            assert event.event_hash == expected
            prev_hash = event.event_hash


def test_audit_events_export_endpoint(client, app):
    flags = dict(app.config.get("FEATURE_FLAGS") or {})
    flags["audit.hash_chain"] = True
    app.config["FEATURE_FLAGS"] = flags

    with app.app_context():
        admin_role = Role.query.filter_by(name="admin").one()
        admin = User(username="admin2", bytes_limit=10 * 1024 * 1024, bytes_used=0, is_active=True)
        admin.set_password("admin2pass")
        admin.roles.append(admin_role)
        db.session.add(admin)
        db.session.commit()

    token = _access_token(client, "admin2", "admin2pass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.get("/api/audit/events?page=1&page_size=5", headers=headers)
    assert response.status_code == 200
    payload = response.get_json()
    assert "items" in payload
