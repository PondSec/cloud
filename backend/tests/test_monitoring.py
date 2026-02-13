from __future__ import annotations

from pathlib import Path

from app.extensions import db
from app.models import AuditLog, Role, SystemMetricSnapshot, User
from app.monitoring.snapshots import run_snapshot_cycle


def _token(client, username: str, password: str) -> str:
    response = client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return response.get_json()["access_token"]


def _create_admin(app) -> User:
    with app.app_context():
        admin_role = Role.query.filter_by(name="admin").one()
        admin = User(username="monitor-admin", bytes_limit=10 * 1024 * 1024, bytes_used=0, is_active=True)
        admin.set_password("monitorpass123")
        admin.roles.append(admin_role)
        db.session.add(admin)
        db.session.commit()
        return admin


def test_monitoring_endpoints_are_auth_protected(client, app):
    _create_admin(app)

    no_token = client.get("/api/monitoring/overview")
    assert no_token.status_code == 401

    user_token = _token(client, "alice", "alicepass")
    user_headers = {"Authorization": f"Bearer {user_token}"}
    forbidden = client.get("/api/monitoring/overview", headers=user_headers)
    assert forbidden.status_code == 403

    admin_token = _token(client, "monitor-admin", "monitorpass123")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    allowed = client.get("/api/monitoring/overview", headers=admin_headers)
    assert allowed.status_code == 200


def test_audit_log_insertion_and_filtering(client, app):
    _create_admin(app)
    admin_token = _token(client, "monitor-admin", "monitorpass123")
    headers = {"Authorization": f"Bearer {admin_token}"}

    failed = client.post("/auth/login", json={"username": "alice", "password": "wrong-password"})
    assert failed.status_code == 401

    logs = client.get(
        "/api/audit/logs?action=auth.login_failed&success=false&page=1&page_size=10",
        headers=headers,
    )
    assert logs.status_code == 200
    payload = logs.get_json()
    assert payload["pagination"]["total"] >= 1
    assert any(item["action"] == "auth.login_failed" for item in payload["items"])

    actions = client.get("/api/audit/actions", headers=headers)
    assert actions.status_code == 200
    assert "auth.login_failed" in actions.get_json()["items"]

    with app.app_context():
        assert AuditLog.query.filter_by(action="auth.login_failed").count() >= 1


def test_snapshot_job_writes_to_db(app):
    with app.app_context():
        assert SystemMetricSnapshot.query.count() == 0
        run_snapshot_cycle(Path(app.config["STORAGE_ROOT"]), retention_days=7)
        assert SystemMetricSnapshot.query.count() == 1
